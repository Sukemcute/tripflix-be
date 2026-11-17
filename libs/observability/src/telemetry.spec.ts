import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { metrics, trace, type Meter, type Span, type Tracer } from '@opentelemetry/api';
import { afterEach, expect, it, vi } from 'vitest';
import { createTelemetryMiddleware } from './telemetry.js';

afterEach(() => vi.restoreAllMocks());

it('records one bounded route metric and span without secrets, even when finish and close both fire', () => {
  const record = vi.fn();
  const span = {
    isRecording: () => true,
    spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }),
    updateName: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  };
  vi.spyOn(trace, 'getTracer').mockReturnValue({
    startSpan: () => span as unknown as Span,
  } as unknown as Tracer);
  vi.spyOn(metrics, 'getMeter').mockReturnValue({ createHistogram: () => ({ record }) } as unknown as Meter);
  const response = Object.assign(new EventEmitter(), {
    statusCode: 503,
    writableFinished: true,
    setHeader: vi.fn(),
  });
  const req = {
    method: 'GET',
    url: '/api/users/private-id?token=query-secret',
    headers: { authorization: 'Bearer auth-secret' },
    route: { path: '/api/users/:id' },
  };
  const next = vi.fn();
  createTelemetryMiddleware()(req as unknown as IncomingMessage, response as unknown as ServerResponse, next);
  response.emit('finish');
  response.emit('close');
  expect(next).toHaveBeenCalledOnce();
  expect(span.end).toHaveBeenCalledOnce();
  expect(record).toHaveBeenCalledOnce();
  expect(span.updateName).toHaveBeenCalledWith('GET /api/users/:id');
  expect(record.mock.calls[0]?.[1]).toEqual({
    'http.request.method': 'GET',
    'http.route': '/api/users/:id',
    'http.response.status_code': 503,
  });
  expect(JSON.stringify(span.setAttributes.mock.calls)).not.toMatch(/private-id|query-secret|auth-secret/);
});

it('skips health probes and groups unknown paths instead of using raw URL labels', () => {
  const record = vi.fn();
  const startSpan = vi.fn(() => ({
    isRecording: () => false,
    updateName: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  }));
  vi.spyOn(trace, 'getTracer').mockReturnValue({ startSpan } as unknown as Tracer);
  vi.spyOn(metrics, 'getMeter').mockReturnValue({ createHistogram: () => ({ record }) } as unknown as Meter);
  const response = Object.assign(new EventEmitter(), {
    statusCode: 404,
    writableFinished: true,
    setHeader: vi.fn(),
  });
  const next = vi.fn();
  const middleware = createTelemetryMiddleware();
  middleware({ url: '/health' } as IncomingMessage, response as unknown as ServerResponse, next);
  expect(startSpan).not.toHaveBeenCalled();
  middleware(
    { url: '/random-secret-id', method: 'GET', headers: {} } as IncomingMessage,
    response as unknown as ServerResponse,
    next,
  );
  response.emit('finish');
  expect(record.mock.calls[0]?.[1]).toMatchObject({ 'http.route': 'unmatched' });
});
