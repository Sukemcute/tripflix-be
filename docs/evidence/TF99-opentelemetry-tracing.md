# TF99 — Distributed tracing bằng OpenTelemetry

- Jira: TF99 · Nhánh: `thanh/TF99-opentelemetry-tracing` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-16
- Dũng (chủ `libs/observability`) đồng ý cách làm và review; anh Thành duyệt thêm 9 thư viện `@opentelemetry/*`.

## Đã làm
- `libs/observability`: `startTracing({ service })` và điểm vào `--import @tripflix/observability/register` cho core-api, notification-service, video-worker. Không có `OTEL_EXPORTER_OTLP_ENDPOINT` thì không nạp SDK.
- Service là ESM nên phải nạp trước app qua `NODE_OPTIONS="--import @tripflix/observability/register"` (hook của `@opentelemetry/instrumentation`); không sửa code, Dockerfile của app.
- Đo HTTP, Express, `pg`, `ioredis`; gắn `trace_id` vào log pino.
- Riêng tư: không ghi tham số SQL (`enhancedDatabaseReporting: false`), lệnh Redis chỉ ghi tên lệnh (Redis đang giữ khoá phiên), không ghi header, body. `pg`, `ioredis` chỉ tạo span trong request (`requireParentSpan`) để job nền không sinh trace rác.
- Thêm 9 gói vào catalog `pnpm-workspace.yaml` (chỉ thêm dòng). README hướng dẫn chạy Jaeger bằng `docker run` (không sửa compose) và bật trên server có sampling.
- Bước 2 (chưa làm): `traceparent` qua outbox sang notification-service.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Tắt thì không nạp gì | Đạt | `tracing.spec.ts` › "không có OTEL_EXPORTER_OTLP_ENDPOINT…" |
| Không lộ tham số SQL, Redis | Đạt | `tracing.spec.ts` (cấu hình); thử thật với Jaeger: span Redis chỉ có `set`, tìm trong toàn bộ trace không thấy chuỗi bí mật đã gửi |
| Trace thật cho core-api | Đạt | Jaeger local: 2.936 trace lúc 1 người đọc, 7.927 trace lúc 10 người đọc, đủ span HTTP, middleware, Redis, từng câu SQL, chờ pool |

## Kết quả đo với trace (core-api sau S1, máy local)
| Phần (trung vị từng phần) | 1 người đọc | 10 người đọc | p99 lúc 10 người |
|---|---:|---:|---:|
| Tổng request | 9,2 ms | 28,4 ms | 81 ms |
| Chờ Postgres (mạng + thực thi + Node giải mã) | 3,8 ms | 13,3 ms | 12,1 ms |
| Chờ kết nối pool | 0,3 ms | 1,1 ms | 1,7 ms |
| Redis | 0,7 ms | 1,9 ms | 9,4 ms |
| Trong Node | 4,2 ms | 10,4 ms | 58,8 ms |

Phát hiện:
- `getDisplayNames` (access) lấy cả dòng `users` (`select()`), gồm `password_hash`, `email`, `phone`, chỉ để lấy tên; chạy ở mọi lượt đọc bình luận, feed, chi tiết bài và lúc thêm bình luận. Đã báo Dũng.
- Lúc 10 người đọc, `pg-pool.connect` 3,4–4,6 ms: 3 câu song song mỗi request (S1) cần nhiều kết nối hơn pool `content` (10).
- Đuôi p99 là xếp hàng trong Node (59/81 ms), không phải DB.

Chi phí tracing (R1 giữ tốc độ, trung vị 3 lần, trace 100%): p95 ở 100 request/giây 29 → 43 ms; ở 150 request/giây 80 → 164 ms (đạt ngưỡng 2/3 → 1/3). Lúc rảnh gần như không tốn; trên server nên lấy mẫu 10%.

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công, lint 0 lỗi.
- `libs/observability`: typecheck, lint, build pass; test 4/4.

## Cách kiểm lại
1. `docker run -d --name tripflix-jaeger -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:2.10.0`.
2. Build core-api, chạy với `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 OTEL_SERVICE_NAME=core-api NODE_OPTIONS="--import @tripflix/observability/register" node dist/main.js`.
3. Gọi vài request, mở http://localhost:16686, chọn service `core-api`.

## Ảnh / video
- Không đính kèm.

## Ảnh hưởng tới phần của người khác
- Có: `libs/observability` (Dũng, đã đồng ý, review); `pnpm-workspace.yaml` catalog (cấu hình chung, chỉ thêm dòng); `pnpm-lock.yaml`. Không đổi hành vi khi không đặt biến môi trường.
