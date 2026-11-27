import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { context, metrics, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { AggregationType, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { createDatabaseInstrumentations } from './tracing.js';

// Một tiến trình chỉ một SDK: register (--import) bật trước, app gọi lại thì nhận đúng SDK đó (TF99).
const STARTED_SDK = Symbol.for('tripflix.observability.sdk');
type GlobalWithSdk = typeof globalThis & { [STARTED_SDK]?: NodeSDK };

/** Explicit HTTP spans avoid ESM loader hooks and never capture bodies, query strings or raw URLs. */
export function startTelemetry(serviceName: string): NodeSDK | undefined {
  if (process.env.OTEL_SDK_DISABLED === 'true' || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const started = (globalThis as GlobalWithSdk)[STARTED_SDK];
  if (started) return started;
  const endpoint = new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (!['http:', 'https:'].includes(endpoint.protocol))
    throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT phải là HTTP(S)');
  const telemetryOrigins = new Set([
    endpoint.origin,
    ...[process.env.ANALYTICS_PROMETHEUS_URL, process.env.ANALYTICS_TEMPO_URL]
      .filter((value): value is string => !!value)
      .map((value) => new URL(value).origin),
  ]);
  const sdk = new NodeSDK({
    autoDetectResources: false,
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME || serviceName,
      'service.instance.id': randomUUID(),
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 15_000 }),
    ],
    instrumentations: [
      new UndiciInstrumentation({
        requireParentforSpans: true,
        ignoreRequestHook: (request) => telemetryOrigins.has(new URL(request.origin).origin),
        // Retain the destination service for distributed traces, without paths or query values.
        startSpanHook: (request) => ({
          'url.full': new URL(request.origin).origin,
          'url.path': '',
          'url.query': '',
        }),
      }),
      // Từng câu SQL, lệnh Redis: không ghi tham số, chỉ trong request. Chỉ có span khi nạp qua register.
      ...createDatabaseInstrumentations(),
    ],
    views: [
      {
        instrumentName: 'tripflix.http.server.duration',
        aggregation: {
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
          options: { boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] },
        },
      },
    ],
  });
  sdk.start();
  (globalThis as GlobalWithSdk)[STARTED_SDK] = sdk;
  const meter = metrics.getMeter('tripflix-runtime');
  meter
    .createObservableGauge('tripflix.service.heartbeat')
    .addCallback((observer) => observer.observe(Date.now() / 1000));
  meter
    .createObservableGauge('tripflix.process.memory', { unit: 'By' })
    .addCallback((observer) => observer.observe(process.memoryUsage().rss));
  meter
    .createObservableGauge('tripflix.process.uptime', { unit: 's' })
    .addCallback((observer) => observer.observe(process.uptime()));
  return sdk;
}

interface RoutedRequest extends IncomingMessage {
  route?: { path?: unknown };
}

export const SUCCESSFUL_CORS_PREFLIGHT_SPAN_NAME = 'OPTIONS CORS preflight';

function isSuccessfulCorsPreflight(req: IncomingMessage, res: ServerResponse, status: number): boolean {
  const origin = req.headers.origin;
  const requestedMethod = req.headers['access-control-request-method'];
  if (req.method !== 'OPTIONS' || typeof origin !== 'string' || !origin || typeof requestedMethod !== 'string' || !requestedMethod || status < 200 || status >= 300) return false;
  const allowsCredentials = res.getHeader('access-control-allow-credentials') === 'true';
  const allowedOrigin = res.getHeader('access-control-allow-origin');
  if (allowedOrigin !== origin && !(allowedOrigin === '*' && !allowsCredentials)) return false;
  const allowedMethods = String(res.getHeader('access-control-allow-methods') ?? '').split(',').map((value) => value.trim());
  if (!allowedMethods.includes(requestedMethod)) return false;
  const allowedHeaders = String(res.getHeader('access-control-allow-headers') ?? '').toLowerCase().split(',').map((value) => value.trim());
  const requestedHeaders = String(req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean);
  return requestedHeaders.every((header) => allowedHeaders.includes(header) || (header !== 'authorization' && allowedHeaders.includes('*') && !allowsCredentials));
}

function requestAudience(route: string, method: string): 'admin' | 'user' | 'other' {
  if (/^\/api\/(?:admin|v1\/admin|analytics)(?:\/|$)/.test(route) || route === '/api/auth/admin-handoff/exchange') {
    return 'admin';
  }
  if (
    /^\/api\/(?:v1\/)?internal(?:\/|$)/.test(route) ||
    route === '/api/auth/service-token' ||
    route === '/api/payments/vnpay/ipn' ||
    route === '/api/v1/posts/:postId/comments/sample' ||
    route === '/api/v1/posts/:postId/comment-stats' ||
    (method === 'PUT' && /^\/api\/v1\/posts\/:postId\/ai-summary(?:\/|$)/.test(route))
  ) {
    return 'other';
  }
  return /^\/(?:api|notifications)(?:\/|$)/.test(route) ? 'user' : 'other';
}

export function createTelemetryMiddleware() {
  const tracer = trace.getTracer('tripflix-http');
  const duration = metrics
    .getMeter('tripflix-http')
    .createHistogram('tripflix.http.server.duration', { unit: 's' });
  return (req: RoutedRequest, res: ServerResponse, next: () => void): void => {
    if (req.url?.split('?')[0] === '/health') {
      next();
      return;
    }
    const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(req.method ?? '')
      ? req.method!
      : 'OTHER';
    const parent = propagation.extract(context.active(), req.headers);
    const span = tracer.startSpan(
      method,
      { kind: SpanKind.SERVER, attributes: { 'http.request.method': method } },
      parent,
    );
    const active = trace.setSpan(parent, span);
    const start = performance.now();
    if (span.isRecording()) res.setHeader('x-trace-id', span.spanContext().traceId);
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      // Express resolves the route after middleware, including denied requests. Unmatched paths share one label.
      const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      const status = res.writableFinished ? res.statusCode : 499;
      const attributes = {
        'http.request.method': method,
        'http.route': route,
        'http.response.status_code': status,
      };
      // Name only confirmed successful preflights; keep unknown/failed CORS requests searchable by default.
      span.updateName(isSuccessfulCorsPreflight(req, res, status) ? SUCCESSFUL_CORS_PREFLIGHT_SPAN_NAME : `${method} ${route}`);
      span.setAttributes(attributes);
      if (status >= 500 || status === 499) span.setStatus({ code: SpanStatusCode.ERROR });
      duration.record((performance.now() - start) / 1000, {
        ...attributes,
        'tripflix.request.audience': requestAudience(route, method),
      }, active);
      span.end();
    };
    res.once('finish', context.bind(active, finish));
    res.once('close', context.bind(active, finish));
    context.with(active, next);
  };
}

export function currentTraceFields(): Record<string, string> {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const { traceId, spanId } = span.spanContext();
  return { traceId, spanId };
}
