import { afterEach, describe, expect, it, vi } from 'vitest';
import { instrumentationConfig, isTracingEnabled, redisStatementWithoutArgs, startTracing } from './tracing.js';

describe('tracing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('không có OTEL_EXPORTER_OTLP_ENDPOINT thì không bật, không nạp SDK', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    expect(isTracingEnabled()).toBe(false);
    expect(await startTracing({ service: 'core-api' })).toBeUndefined();
  });

  it('có endpoint thì bật', () => {
    expect(isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' })).toBe(true);
  });

  it('không ghi tham số SQL, Redis vào span; DB chỉ đo khi đang trong một request', () => {
    const config = instrumentationConfig();

    expect(config.pg).toEqual({ enhancedDatabaseReporting: false, requireParentSpan: true });
    expect(config.ioredis.requireParentSpan).toBe(true);
    // Redis đang giữ khoá phiên (sid): span chỉ có tên lệnh.
    expect(redisStatementWithoutArgs('get')).toBe('get');
    expect(config.ioredis.dbStatementSerializer).toBe(redisStatementWithoutArgs);
  });
});
