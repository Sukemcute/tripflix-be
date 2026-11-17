import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTelemetry } from './telemetry.js';
import { instrumentationConfig, isTracingEnabled, redisStatementWithoutArgs } from './tracing.js';

describe('tracing pg, ioredis (TF99)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('chỉ bật khi có endpoint và không tắt SDK, cùng điều kiện với startTelemetry', () => {
    expect(isTracingEnabled({})).toBe(false);
    expect(isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: ' ' })).toBe(false);
    expect(isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' })).toBe(true);
    expect(
      isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318', OTEL_SDK_DISABLED: 'true' }),
    ).toBe(false);
  });

  it('không ghi tham số SQL, Redis vào span; DB chỉ đo khi đang trong một request', () => {
    const config = instrumentationConfig();

    expect(config.pg).toEqual({ enhancedDatabaseReporting: false, requireParentSpan: true });
    expect(config.ioredis.requireParentSpan).toBe(true);
    // Redis đang giữ khoá phiên (sid): span chỉ có tên lệnh.
    expect(redisStatementWithoutArgs('get')).toBe('get');
    expect(config.ioredis.dbStatementSerializer).toBe(redisStatementWithoutArgs);
  });

  it('register bật trước rồi app gọi lại: một tiến trình chỉ có một SDK', async () => {
    // Collector giả trả 200 ngay: lúc tắt SDK gửi nốt metric, không phụ thuộc mạng ngoài (CI không có collector).
    const collector: Server = createServer((request, response) => {
      request.resume();
      request.on('end', () => response.writeHead(200).end());
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    const { port } = collector.address() as AddressInfo;
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', `http://127.0.0.1:${port}`);

    try {
      const early = startTelemetry('core-api');
      const again = startTelemetry('core-api');

      expect(early).toBeDefined();
      expect(again).toBe(early);
      await early?.shutdown();
    } finally {
      await new Promise((resolve) => collector.close(resolve));
    }
  });
});
