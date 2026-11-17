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
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:4318');

    const early = startTelemetry('core-api');
    const again = startTelemetry('core-api');

    expect(early).toBeDefined();
    expect(again).toBe(early);
    await early?.shutdown();
  });
});
