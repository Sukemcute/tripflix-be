import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { SUCCESSFUL_CORS_PREFLIGHT_SPAN_NAME } from '@tripflix/observability';
import {
  RANGE_SECONDS,
  type ObservabilityDto,
  type ObservabilityQuery,
  type TelemetryRouteDto,
  type TelemetrySummaryDto,
  type TraceDetailDto,
  type TraceListDto,
  type TraceQuery,
} from '../api/dto.js';
import {
  finiteValue,
  PrometheusResponseSchema,
  readTelemetryJson,
  type PrometheusSample,
  type TelemetryEnv,
} from '../infra/telemetry-store.js';

export const TELEMETRY_ENV = Symbol('TELEMETRY_ENV');
const HISTOGRAM = 'tripflix_http_server_duration_seconds';
const EMPTY_SUMMARY = {
  requests: null,
  requestRate: null,
  errorRate: null,
  p50Ms: null,
  p95Ms: null,
} satisfies TelemetrySummaryDto;
const TraceSearchSchema = z.object({
  traces: z
    .array(
      z.object({
        // Tempo search can omit leading zeroes from the 128-bit hexadecimal ID.
        traceID: z
          .string()
          .regex(/^[a-f0-9]{1,32}$/i)
          .transform((value) => value.padStart(32, '0')),
        rootServiceName: z.string().default(''),
        rootTraceName: z.string().default(''),
        startTimeUnixNano: z.string().regex(/^\d+$/),
        durationMs: z.number().nonnegative(),
      }),
    )
    .default([]),
});
const AttributeSchema = z.object({
  key: z.string(),
  value: z.object({
    stringValue: z.string().optional(),
    intValue: z.union([z.string(), z.number()]).optional(),
  }),
});
const TracePayloadSchema = z.object({
  batches: z
    .array(
      z.object({
        resource: z.object({ attributes: z.array(AttributeSchema).default([]) }).optional(),
        scopeSpans: z
          .array(
            z.object({
              spans: z.array(
                z.object({
                  traceId: z.string(),
                  spanId: z.string(),
                  parentSpanId: z.string().default(''),
                  name: z.string(),
                  startTimeUnixNano: z.string().regex(/^\d+$/),
                  endTimeUnixNano: z.string().regex(/^\d+$/),
                  status: z.object({ code: z.union([z.number(), z.string()]).optional() }).optional(),
                  attributes: z.array(AttributeSchema).default([]),
                }),
              ),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const stat = (expression: string, name: string) =>
  `label_replace((${expression}), "stat", "${name}", "", "")`;
const valueOf = (rows: PrometheusSample[], name: string): number | null =>
  finiteValue(rows.find((row) => row.metric.stat === name)?.value?.[1]);
const ratio = (errors: number | null, requests: number | null): number | null =>
  requests !== null && requests > 0 ? Math.max(0, (errors ?? 0) / requests) : null;
const milliseconds = (value: number | null): number | null =>
  value === null ? null : Math.max(0, value * 1000);
const spanIdHex = (value: string): string =>
  /^[a-f0-9]{16}$/i.test(value) ? value.toLowerCase() : Buffer.from(value, 'base64').toString('hex');
const summarize = (rows: PrometheusSample[]) => ({
  requests: valueOf(rows, 'requests'),
  requestRate: valueOf(rows, 'rate'),
  errorRate: ratio(valueOf(rows, 'errors'), valueOf(rows, 'requests')),
  p50Ms: milliseconds(valueOf(rows, 'p50')),
  p95Ms: milliseconds(valueOf(rows, 'p95')),
});

@Injectable()
export class ObservabilityService {
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<ObservabilityDto> }>();
  constructor(@Inject(TELEMETRY_ENV) private readonly env: TelemetryEnv) {}

  getOverview(query: ObservabilityQuery): Promise<ObservabilityDto> {
    const key = JSON.stringify(query);
    const previous = this.cache.get(key);
    if (previous && previous.expiresAt > Date.now()) return previous.value;
    if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
    const value = this.loadOverview(query);
    this.cache.set(key, { expiresAt: Date.now() + 15_000, value });
    return value;
  }

  private async loadOverview(query: ObservabilityQuery): Promise<ObservabilityDto> {
    const to = Math.floor(Date.now() / 1000);
    const from = to - RANGE_SECONDS[query.range];
    const empty = {
      generatedAt: Date.now(),
      from: from * 1000,
      to: to * 1000,
      metricsSource: { status: 'not_configured' },
      summary: { ...EMPTY_SUMMARY },
      series: [],
      services: [],
      routes: [],
    } satisfies ObservabilityDto;
    const base = this.env.ANALYTICS_PROMETHEUS_URL;
    if (!base) return empty;
    const serviceFilters = query.service ? [`service_name=${JSON.stringify(query.service)}`] : [];
    const requestFilters = query.audience
      ? [...serviceFilters, `tripflix_request_audience=${JSON.stringify(query.audience)}`]
      : serviceFilters;
    const serviceSelector = `{${serviceFilters.join(',')}}`;
    const selector = `{${requestFilters.join(',')}}`;
    const errors = `{${[...requestFilters, 'http_response_status_code=~"5.."'].join(',')}}`;
    const window = `${RANGE_SECONDS[query.range]}s`;
    const metricsFor = (group: string) => [
      stat(`sum ${group}(increase(${HISTOGRAM}_count${selector}[${window}]))`, 'requests'),
      stat(`sum ${group}(increase(${HISTOGRAM}_count${errors}[${window}]))`, 'errors'),
      stat(`sum ${group}(rate(${HISTOGRAM}_count${selector}[5m]))`, 'rate'),
      ...[50, 95].map((percentile) =>
        stat(
          `histogram_quantile(${percentile / 100}, sum by (le${group ? ',service_name' : ''})(rate(${HISTOGRAM}_bucket${selector}[5m])))`,
          `p${percentile}`,
        ),
      ),
    ];
    const vectorQuery = [
      ...metricsFor('by (service_name)'),
      stat(`max by (service_name)(tripflix_service_heartbeat${serviceSelector})`, 'heartbeat'),
      stat(
        `sum by (service_name)(tripflix_process_memory_bytes${serviceSelector} and on (service_name,service_instance_id) (tripflix_service_heartbeat${serviceSelector} > time() - 60))`,
        'memory',
      ),
      stat(
        `min by (service_name)(tripflix_process_uptime_seconds${serviceSelector} and on (service_name,service_instance_id) (tripflix_service_heartbeat${serviceSelector} > time() - 60))`,
        'uptime',
      ),
      // Global quantiles must use merged buckets, never averages of per-service quantiles.
      ...metricsFor('').map((expression) => `label_replace((${expression}), "scope", "global", "", "")`),
    ].join(' or ');
    const routeGroup = 'by (service_name,http_request_method,http_route)';
    const routeQuery = [
      stat(`topk(20, sum ${routeGroup}(increase(${HISTOGRAM}_count${selector}[${window}])))`, 'requests'),
      stat(`sum ${routeGroup}(increase(${HISTOGRAM}_count${errors}[${window}]))`, 'errors'),
      stat(
        `histogram_quantile(0.95, sum by (le,service_name,http_request_method,http_route)(rate(${HISTOGRAM}_bucket${selector}[5m])))`,
        'p95',
      ),
    ].join(' or ');
    const rangeQuery = [
      stat(`sum(rate(${HISTOGRAM}_count${selector}[5m]))`, 'rate'),
      stat(
        `(sum(rate(${HISTOGRAM}_count${errors}[5m])) or vector(0)) / sum(rate(${HISTOGRAM}_count${selector}[5m]))`,
        'errors',
      ),
      stat(`histogram_quantile(0.95, sum by (le)(rate(${HISTOGRAM}_bucket${selector}[5m])))`, 'p95'),
    ].join(' or ');
    const read = async (path: string, params: Record<string, string>) =>
      PrometheusResponseSchema.parse(await readTelemetryJson(base, path, params)).data.result;
    try {
      const [vectors, routeVectors, ranges] = await Promise.all([
        read('/api/v1/query', { query: vectorQuery, time: String(to) }),
        read('/api/v1/query', { query: routeQuery, time: String(to) }),
        read('/api/v1/query_range', {
          query: rangeQuery,
          start: String(from),
          end: String(to),
          step: String(Math.max(15, Math.ceil(RANGE_SECONDS[query.range] / 120))),
        }),
      ]);
      const services = [
        ...new Set(vectors.map((row) => row.metric.service_name).filter((name): name is string => !!name)),
      ]
        .sort()
        .map((name) => {
          const rows = vectors.filter((row) => row.metric.service_name === name);
          const heartbeat = valueOf(rows, 'heartbeat');
          return {
            name,
            ...summarize(rows),
            lastSeenAt: heartbeat === null ? null : heartbeat * 1000,
            isHealthy: heartbeat !== null && to - heartbeat < 60,
            memoryBytes: valueOf(rows, 'memory'),
            uptimeSeconds: valueOf(rows, 'uptime'),
          };
        });
      const routes: TelemetryRouteDto[] = routeVectors
        .filter((row) => row.metric.stat === 'requests')
        .map((row) => {
          const rows = routeVectors.filter(
            (candidate) =>
              candidate.metric.service_name === row.metric.service_name &&
              candidate.metric.http_route === row.metric.http_route &&
              candidate.metric.http_request_method === row.metric.http_request_method,
          );
          return {
            service: row.metric.service_name ?? '',
            method: row.metric.http_request_method ?? '',
            route: row.metric.http_route ?? '',
            requests: valueOf(rows, 'requests') ?? 0,
            errorRate: ratio(valueOf(rows, 'errors'), valueOf(rows, 'requests')),
            p95Ms: milliseconds(valueOf(rows, 'p95')),
          };
        })
        .sort((left, right) => right.requests - left.requests);
      const timestamps = [...new Set(ranges.flatMap((row) => (row.values ?? []).map(([at]) => at)))].sort(
        (a, b) => a - b,
      );
      const series = timestamps.map((at) => {
        const sample = (name: string) =>
          finiteValue(
            ranges.find((row) => row.metric.stat === name)?.values?.find(([time]) => time === at)?.[1],
          );
        return {
          at: at * 1000,
          requestRate: sample('rate'),
          errorRate: sample('errors'),
          p95Ms: milliseconds(sample('p95')),
        };
      });
      return {
        ...empty,
        metricsSource: { status: 'ready' },
        summary: summarize(vectors.filter((row) => row.metric.scope === 'global')),
        series,
        services,
        routes,
      };
    } catch {
      return { ...empty, metricsSource: { status: 'unavailable' } };
    }
  }

  async listTraces(query: TraceQuery): Promise<TraceListDto> {
    const base = this.env.ANALYTICS_TEMPO_URL;
    const empty = { source: { status: 'not_configured' }, traces: [], limit: 50 } satisfies TraceListDto;
    if (!base) return empty;
    const predicates: string[] = [];
    if (!query.includeSuccessfulPreflights) predicates.push(`trace:rootName != ${JSON.stringify(SUCCESSFUL_CORS_PREFLIGHT_SPAN_NAME)}`);
    if (query.service) predicates.push(`resource.service.name = ${JSON.stringify(query.service)}`);
    if (query.errorsOnly) predicates.push('status = error');
    if (query.minDurationMs) predicates.push(`duration >= ${query.minDurationMs}ms`);
    if (!predicates.length) predicates.push('duration >= 0ms');
    const end = Math.floor(Date.now() / 1000);
    try {
      const payload = TraceSearchSchema.parse(
        await readTelemetryJson(base, '/api/search', {
          q: `{ ${predicates.join(' && ')} }`,
          start: String(end - RANGE_SECONDS[query.range]),
          end: String(end),
          limit: '50',
        }),
      );
      return {
        ...empty,
        source: { status: 'ready' },
        traces: payload.traces
          .map((row) => ({
            traceId: row.traceID.toLowerCase(),
            service: row.rootServiceName,
            operation: row.rootTraceName,
            startedAt: Number(BigInt(row.startTimeUnixNano) / 1_000_000n),
            durationMs: row.durationMs,
          }))
          .sort((a, b) => b.startedAt - a.startedAt),
      };
    } catch {
      return { ...empty, source: { status: 'unavailable' } };
    }
  }

  async getTrace(traceId: string): Promise<TraceDetailDto> {
    const base = this.env.ANALYTICS_TEMPO_URL;
    if (!base) throw new ServiceUnavailableException('Chưa cấu hình kho trace');
    let raw: unknown;
    try {
      raw = await readTelemetryJson(base, `/api/traces/${traceId}`);
    } catch (error) {
      if (error instanceof Error && error.message === 'Telemetry HTTP 404')
        throw new NotFoundException('Không tìm thấy trace');
      throw new ServiceUnavailableException('Không đọc được kho trace');
    }
    const payload = TracePayloadSchema.safeParse(raw);
    if (!payload.success) throw new ServiceUnavailableException('Dữ liệu trace không hợp lệ');
    const spans = payload.data.batches
      .flatMap((batch) => {
        const service =
          batch.resource?.attributes.find((attribute) => attribute.key === 'service.name')?.value
            .stringValue ?? '';
        return batch.scopeSpans.flatMap((scope) =>
          scope.spans.map((span) => ({
            spanId: spanIdHex(span.spanId),
            parentSpanId: span.parentSpanId ? spanIdHex(span.parentSpanId) : '',
            service,
            operation: span.name,
            startedAt: Number(BigInt(span.startTimeUnixNano) / 1_000_000n),
            durationMs: Number(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1_000_000,
            isError: span.status?.code === 2 || span.status?.code === 'STATUS_CODE_ERROR',
            httpStatus: finiteValue(
              String(
                span.attributes.find((attribute) => attribute.key === 'http.response.status_code')?.value
                  .intValue ?? '',
              ),
            ),
          })),
        );
      })
      .sort((a, b) => a.startedAt - b.startedAt);
    return { traceId, spans };
  }
}
