/**
 * Điểm vào cho `node --import @tripflix/observability/register` (TF99): bật startTelemetry sớm, trước khi app import
 * pg, ioredis, để có thêm span cho từng câu SQL, lệnh Redis. App gọi startTelemetry sau đó nhận lại đúng SDK này.
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 OTEL_SERVICE_NAME=core-api \
 *   NODE_OPTIONS="--import @tripflix/observability/register" node dist/main.js
 * Không có OTEL_EXPORTER_OTLP_ENDPOINT thì không đăng ký hook, không nạp SDK.
 */
import { register } from 'node:module';
import { basename } from 'node:path';
import { startTelemetry } from './telemetry.js';
import { isTracingEnabled } from './tracing.js';

if (isTracingEnabled()) {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  // Chưa biết tên service ở đây: OTEL_SERVICE_NAME được ưu tiên, không có thì lấy tên thư mục app (apps/core-api).
  startTelemetry(basename(process.cwd()));
}
