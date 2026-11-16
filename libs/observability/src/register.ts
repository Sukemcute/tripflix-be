/**
 * Điểm vào cho `node --import @tripflix/observability/register` (TF99).
 * Dùng chung cho core-api, notification-service, video-worker: đặt NODE_OPTIONS, không sửa code hay Dockerfile của app.
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 OTEL_SERVICE_NAME=core-api \
 *   NODE_OPTIONS="--import @tripflix/observability/register" node dist/main.js
 * Không có OTEL_EXPORTER_OTLP_ENDPOINT thì không đăng ký hook, không nạp SDK.
 */
import { register } from 'node:module';
import { isTracingEnabled, startTracing } from './tracing.js';

if (isTracingEnabled()) {
  // Hook ESM phải đăng ký trước khi app import pg, ioredis, express thì mới bọc được các module đó.
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  const stop = await startTracing({ service: 'tripflix' });
  // Đẩy nốt span trong bộ đệm khi service tắt; không chặn việc tắt nếu collector không trả lời.
  // Dùng once: app (enableShutdownHooks của Nest, hoặc handler riêng) vẫn tự xử lý SIGTERM và thoát như cũ.
  process.once('SIGTERM', () => void stop?.().catch(() => undefined));
}
