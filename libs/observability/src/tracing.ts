/**
 * Distributed tracing bằng OpenTelemetry (TF99). Chỉ nạp SDK khi có OTEL_EXPORTER_OTLP_ENDPOINT:
 * không đặt biến thì không import gì, không tốn gì.
 *
 * Service ESM phải nạp qua `node --import @tripflix/observability/register` (hoặc NODE_OPTIONS) để hook kịp bọc
 * pg, ioredis, express trước khi app import chúng; gọi startTracing() sau khi app đã import thì không đo được.
 * Sampling, endpoint, header dùng biến chuẩn của OpenTelemetry (OTEL_TRACES_SAMPLER, OTEL_TRACES_SAMPLER_ARG...).
 */

export interface TracingOptions {
  /** Tên service trong trace, ví dụ core-api. OTEL_SERVICE_NAME (nếu có) được ưu tiên. */
  service: string;
}

/** Lệnh Redis chỉ ghi tên lệnh: tham số chứa khoá phiên, token, dữ liệu người dùng. */
export function redisStatementWithoutArgs(commandName: string): string {
  return commandName;
}

/**
 * Cấu hình đo cho từng thư viện. Tách riêng để test được các ràng buộc riêng tư:
 * - pg: không ghi giá trị tham số (câu SQL chỉ có $1, $2), nội dung bình luận, email không lọt vào trace.
 * - pg, ioredis: chỉ tạo span khi đang trong một request; job nền (outbox relay quét 500 ms) không sinh trace rác.
 * - http: không ghi header, body (mặc định của thư viện).
 */
export function instrumentationConfig() {
  return {
    pg: { enhancedDatabaseReporting: false, requireParentSpan: true },
    ioredis: { requireParentSpan: true, dbStatementSerializer: redisStatementWithoutArgs },
  } as const;
}

export function isTracingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

/** Bật tracing. Trả hàm dừng (đẩy nốt span còn trong bộ đệm), hoặc undefined khi không bật. */
export async function startTracing({ service }: TracingOptions): Promise<(() => Promise<void>) | undefined> {
  if (!isTracingEnabled()) return undefined;

  const [
    { NodeSDK },
    { OTLPTraceExporter },
    { HttpInstrumentation },
    { ExpressInstrumentation },
    { PgInstrumentation },
    { IORedisInstrumentation },
    { PinoInstrumentation },
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-proto'),
    import('@opentelemetry/instrumentation-http'),
    import('@opentelemetry/instrumentation-express'),
    import('@opentelemetry/instrumentation-pg'),
    import('@opentelemetry/instrumentation-ioredis'),
    import('@opentelemetry/instrumentation-pino'),
  ]);

  const config = instrumentationConfig();
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME?.trim() || service,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new PgInstrumentation(config.pg),
      new IORedisInstrumentation(config.ioredis),
      // Gắn trace_id, span_id vào mỗi dòng log pino để từ log nhảy sang trace.
      new PinoInstrumentation(),
    ],
  });
  sdk.start();
  return () => sdk.shutdown();
}
