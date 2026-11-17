/**
 * Đo từng câu SQL (pg) và lệnh Redis (ioredis) cho bộ OpenTelemetry chung `startTelemetry` (TF99).
 *
 * Service ESM chỉ bọc được pg, ioredis khi nạp qua `node --import @tripflix/observability/register`
 * (hook ESM phải đăng ký trước khi app import các thư viện này). Không nạp như vậy thì phần đo này không tạo span,
 * các span HTTP, metric của startTelemetry vẫn chạy như cũ.
 */
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

/** Lệnh Redis chỉ ghi tên lệnh: tham số chứa khoá phiên, token, dữ liệu người dùng. */
export function redisStatementWithoutArgs(commandName: string): string {
  return commandName;
}

/**
 * Cấu hình đo cho từng thư viện. Tách riêng để test được các ràng buộc riêng tư:
 * - pg: không ghi giá trị tham số (câu SQL chỉ có $1, $2), nội dung bình luận, email không lọt vào trace.
 * - pg, ioredis: chỉ tạo span khi đang trong một request; job nền (outbox relay quét 500 ms) không sinh trace rác.
 */
export function instrumentationConfig() {
  return {
    pg: { enhancedDatabaseReporting: false, requireParentSpan: true },
    ioredis: { requireParentSpan: true, dbStatementSerializer: redisStatementWithoutArgs },
  } as const;
}

/** Chỉ gọi khi đã bật tracing: tạo instrumentation là đăng ký hook bọc thư viện ngay. */
export function createDatabaseInstrumentations() {
  const config = instrumentationConfig();
  return [new PgInstrumentation(config.pg), new IORedisInstrumentation(config.ioredis)];
}

/** Cùng điều kiện với startTelemetry: có endpoint và không tắt SDK. */
export function isTracingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OTEL_SDK_DISABLED !== 'true' && Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}
