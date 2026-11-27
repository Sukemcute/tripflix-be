import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { metrics, trace, type Meter, type Span, type Tracer } from '@opentelemetry/api';
import { afterEach, expect, it, vi } from 'vitest';
import { createTelemetryMiddleware, SUCCESSFUL_CORS_PREFLIGHT_SPAN_NAME } from './telemetry.js';

afterEach(() => vi.restoreAllMocks());

it.each([
  { name: 'successful preflight', method: 'OPTIONS', status: 204, origin: true, requestedMethod: true, allowedOrigin: 'https://client.test', allowedMethod: 'GET', requestedHeader: 'authorization', allowedHeader: 'Authorization', success: true },
  { name: 'failed HTTP preflight', method: 'OPTIONS', status: 403, origin: true, requestedMethod: true, allowedOrigin: 'https://client.test', allowedMethod: 'GET', success: false },
  { name: 'origin rejected with 204', method: 'OPTIONS', status: 204, origin: true, requestedMethod: true, allowedMethod: 'GET', success: false },
  { name: 'method rejected with 204', method: 'OPTIONS', status: 204, origin: true, requestedMethod: true, allowedOrigin: 'https://client.test', allowedMethod: 'POST', success: false },
  { name: 'header rejected with 204', method: 'OPTIONS', status: 204, origin: true, requestedMethod: true, allowedOrigin: 'https://client.test', allowedMethod: 'GET', requestedHeader: 'authorization', allowedHeader: 'content-type', success: false },
  { name: 'ordinary OPTIONS', method: 'OPTIONS', status: 200, origin: false, requestedMethod: false, success: false },
  { name: 'ordinary GET', method: 'GET', status: 200, origin: true, requestedMethod: true, allowedOrigin: 'https://client.test', allowedMethod: 'GET', success: false },
  { name: 'invalid credentials wildcard', method: 'OPTIONS', status: 204, origin: true, requestedMethod: true, allowedOrigin: '*', allowedMethod: 'GET', credentials: true, success: false },
])('classifies $name while retaining the metric and span', (fixture) => {
  const record = vi.fn();
  const span = { isRecording: () => false, updateName: vi.fn(), setAttributes: vi.fn(), setStatus: vi.fn(), end: vi.fn() };
  vi.spyOn(trace, 'getTracer').mockReturnValue({ startSpan: () => span } as unknown as Tracer);
  vi.spyOn(metrics, 'getMeter').mockReturnValue({ createHistogram: () => ({ record }) } as unknown as Meter);
  const responseHeaders: Record<string, string | undefined> = { 'access-control-allow-origin': fixture.allowedOrigin, 'access-control-allow-methods': fixture.allowedMethod, 'access-control-allow-headers': fixture.allowedHeader, 'access-control-allow-credentials': fixture.credentials ? 'true' : undefined };
  const response = Object.assign(new EventEmitter(), { statusCode: fixture.status, writableFinished: true, getHeader: (name: string) => responseHeaders[name] });
  const req = { method: fixture.method, headers: { ...(fixture.origin ? { origin: 'https://client.test' } : {}), ...(fixture.requestedMethod ? { 'access-control-request-method': 'GET' } : {}), ...(fixture.requestedHeader ? { 'access-control-request-headers': fixture.requestedHeader } : {}) } };
  createTelemetryMiddleware()(req as IncomingMessage, response as unknown as ServerResponse, () => {});
  response.emit('finish'); response.emit('close');
  expect(span.updateName).toHaveBeenCalledWith(fixture.success ? SUCCESSFUL_CORS_PREFLIGHT_SPAN_NAME : `${fixture.method} unmatched`);
  expect(record).toHaveBeenCalledOnce(); expect(span.end).toHaveBeenCalledOnce();
  expect(record.mock.calls[0]?.[1]).toMatchObject({ 'http.request.method': fixture.method, 'http.response.status_code': fixture.status });
  expect(JSON.stringify(span.setAttributes.mock.calls)).not.toContain('client.test');
});

it.each([
  ['/api/v1/posts/:id/comment-permissions', 'user'],
  ['/api/admin/search', 'admin'],
  ['/api/analytics/observability', 'admin'],
  ['/api/v1/internal/ai-summary/reconciliation', 'other'],
])('records a bounded metric for %s with only one finish', (route, audience) => {
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
    route: { path: route },
  };
  const next = vi.fn();
  createTelemetryMiddleware()(req as unknown as IncomingMessage, response as unknown as ServerResponse, next);
  response.emit('finish');
  response.emit('close');
  expect(next).toHaveBeenCalledOnce();
  expect(span.end).toHaveBeenCalledOnce();
  expect(record).toHaveBeenCalledOnce();
  expect(span.updateName).toHaveBeenCalledWith('GET ' + route);
  expect(record.mock.calls[0]?.[1]).toEqual({
    'http.request.method': 'GET',
    'http.route': route,
    'tripflix.request.audience': audience,
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
