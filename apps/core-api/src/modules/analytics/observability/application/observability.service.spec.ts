import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ObservabilityService } from './observability.service.js';
import { ObservabilityController } from '../api/observability.controller.js';
import { TelemetryEnvSchema } from '../infra/telemetry-store.js';

const sample = (stat: string, value: string, labels = {}) => ({
  metric: { stat, ...labels },
  value: [1, value],
});
const response = (result: unknown[], resultType = 'vector') =>
  new Response(JSON.stringify({ status: 'success', data: { resultType, result } }), {
    headers: { 'content-type': 'application/json' },
  });
const env = { ANALYTICS_PROMETHEUS_URL: 'http://prometheus.test', ANALYTICS_TEMPO_URL: 'http://tempo.test' };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('distinguishes unconfigured sources from measured zero without making requests', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const service = new ObservabilityService({});
  expect(await service.getOverview({ range: '1h' })).toMatchObject({
    metricsSource: { status: 'not_configured' },
    summary: { requests: null, errorRate: null },
    services: [],
  });
  expect(await service.listTraces({ range: '1h', errorsOnly: false, minDurationMs: 0 })).toMatchObject({
    source: { status: 'not_configured' },
  });
  expect(fetch).not.toHaveBeenCalled();
});

it('merges histogram buckets server-side, normalizes nonfinite samples, keeps gaps and caches concurrent reads', async () => {
  const fetch = vi.fn(async (input: URL) => {
    if (input.pathname.endsWith('query_range'))
      return response(
        [
          {
            metric: { stat: 'rate' },
            values: [
              [1, '2'],
              [2, 'NaN'],
              [3, '0'],
            ],
          },
          {
            metric: { stat: 'p95' },
            values: [
              [1, '0.25'],
              [3, '+Inf'],
            ],
          },
        ],
        'matrix',
      );
    if (input.searchParams.get('query')?.includes('topk'))
      return response([
        sample('requests', '10', {
          service_name: 'core-api',
          http_request_method: 'GET',
          http_route: '/api/posts/:id',
        }),
        sample('errors', '2', {
          service_name: 'core-api',
          http_request_method: 'GET',
          http_route: '/api/posts/:id',
        }),
        sample('p95', '0.5', {
          service_name: 'core-api',
          http_request_method: 'GET',
          http_route: '/api/posts/:id',
        }),
      ]);
    return response([
      sample('requests', '20', { scope: 'global' }),
      sample('errors', '2', { scope: 'global' }),
      sample('p95', '0.25', { scope: 'global' }),
      sample('requests', '20', { service_name: 'core-api' }),
      sample('heartbeat', String(Date.now() / 1000), { service_name: 'core-api' }),
      sample('memory', '1234', { service_name: 'core-api' }),
    ]);
  });
  vi.stubGlobal('fetch', fetch);
  const service = new ObservabilityService(env);
  const query = { range: '1h' as const, service: 'core-api' };
  const [first, second] = await Promise.all([service.getOverview(query), service.getOverview(query)]);
  expect(first).toBe(second);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(first.summary).toMatchObject({ requests: 20, errorRate: 0.1, p95Ms: 250 });
  expect(first.services[0]).toMatchObject({
    name: 'core-api',
    isHealthy: true,
    errorRate: 0,
    memoryBytes: 1234,
  });
  expect(first.routes[0]).toMatchObject({
    route: '/api/posts/:id',
    requests: 10,
    errorRate: 0.2,
    p95Ms: 500,
  });
  expect(first.series).toEqual([
    { at: 1000, requestRate: 2, errorRate: null, p95Ms: 250 },
    { at: 2000, requestRate: null, errorRate: null, p95Ms: null },
    { at: 3000, requestRate: 0, errorRate: null, p95Ms: null },
  ]);
  const request = fetch.mock.calls[0]![0];
  expect(request.searchParams.get('query')).toContain('sum by (le)(rate(');
  expect(request.searchParams.get('query')).toContain('service_name="core-api"');
});

it('does not expose upstream failure details or replace failures with zero', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('secret connection detail', { status: 500 })),
  );
  const service = new ObservabilityService(env);
  const overview = await service.getOverview({ range: '15m' });
  expect(overview.metricsSource.status).toBe('unavailable');
  expect(overview.summary.requests).toBeNull();
  expect(JSON.stringify(overview)).not.toContain('secret');
});

it('marks stale heartbeat and handles ready source with no samples', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) =>
      response(
        input.searchParams.get('query')?.includes('heartbeat')
          ? [sample('heartbeat', '1', { service_name: 'worker' })]
          : [],
      ),
    ),
  );
  const overview = await new ObservabilityService(env).getOverview({ range: '6h' });
  expect(overview.metricsSource.status).toBe('ready');
  expect(overview.services[0]?.isHealthy).toBe(false);
  expect(overview.summary.requests).toBeNull();
});

it('builds bounded TraceQL filters, sorts traces and retains nanosecond precision using BigInt', async () => {
  const fetch = vi.fn(
    async (_input: URL) =>
      new Response(
        JSON.stringify({
          traces: [
            {
              traceID: 'a'.repeat(31),
              rootServiceName: 'core-api',
              rootTraceName: 'GET /api/posts',
              startTimeUnixNano: '1794820000123456789',
              durationMs: 250,
            },
          ],
        }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const result = await new ObservabilityService(env).listTraces({
    range: '24h',
    service: 'core-api',
    errorsOnly: true,
    minDurationMs: 100,
  });
  expect(result.traces[0]).toMatchObject({
    traceId: `0${'a'.repeat(31)}`,
    startedAt: 1794820000123,
    durationMs: 250,
  });
  const url = fetch.mock.calls[0]![0] as unknown as URL;
  expect(url.searchParams.get('q')).toContain('resource.service.name = "core-api"');
  expect(url.searchParams.get('q')).toContain('status = error');
  expect(url.searchParams.get('limit')).toBe('50');
});

it('trace detail returns only allowlisted fields, not arbitrary attributes or exception messages', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            batches: [
              {
                resource: { attributes: [{ key: 'service.name', value: { stringValue: 'core-api' } }] },
                scopeSpans: [
                  {
                    spans: [
                      {
                        traceId: 'a'.repeat(32),
                        spanId: Buffer.from('b'.repeat(16), 'hex').toString('base64'),
                        name: 'GET /api/posts/:id',
                        startTimeUnixNano: '1794820000123456789',
                        endTimeUnixNano: '1794820000124456789',
                        status: { code: 2, message: 'private detail' },
                        attributes: [
                          { key: 'http.response.status_code', value: { intValue: '500' } },
                          { key: 'authorization', value: { stringValue: 'secret' } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        ),
    ),
  );
  const result = await new ObservabilityService(env).getTrace('a'.repeat(32));
  expect(result.spans[0]).toMatchObject({
    spanId: 'b'.repeat(16),
    durationMs: 1,
    isError: true,
    httpStatus: 500,
  });
  expect(JSON.stringify(result)).not.toMatch(/secret|authorization|private detail/);
});

it('validates filters before making upstream requests, and restricts all endpoints to superadmin', () => {
  const controller = new ObservabilityController(new ObservabilityService(env));
  expect(() => controller.getOverview({ range: '90d' })).toThrow(BadRequestException);
  expect(() => controller.getOverview({ service: 'x"} or up{' })).toThrow(BadRequestException);
  expect(() => controller.listTraces({ minDurationMs: '-1' })).toThrow(BadRequestException);
  expect(() => controller.getTrace('../metrics')).toThrow(BadRequestException);
  expect(Reflect.getMetadata('tripflix:roles', ObservabilityController)).toEqual(['superadmin']);
  expect(() => TelemetryEnvSchema.parse({ ANALYTICS_TEMPO_URL: 'file:///etc/passwd' })).toThrow();
});

it('maps absent and broken trace storage to explicit errors', async () => {
  await expect(new ObservabilityService({}).getTrace('a'.repeat(32))).rejects.toBeInstanceOf(
    ServiceUnavailableException,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  await expect(new ObservabilityService(env).getTrace('a'.repeat(32))).rejects.toBeInstanceOf(
    NotFoundException,
  );
});
