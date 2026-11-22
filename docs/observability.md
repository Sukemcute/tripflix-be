# Analytics và observability

Trang quản trị `/analytics` đọc metric từ Prometheus và trace từ Tempo qua core-api. Dữ liệu vận hành không truy vấn bảng nghiệp vụ. Đây là phần giám sát kỹ thuật; bảng xu hướng A15 và thống kê hội thoại B7 chưa nằm trong thay đổi này.

## Chạy cùng stack local

Từ gốc repo backend:

```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.observability.yaml -f deploy/compose.observability-apps.yaml --profile be --profile fe --profile gateway up -d --build
```

File overlay chỉ thêm cấu hình telemetry cho core-api và notification-service. Các service cũ giữ cấu hình trong compose gốc. Các cổng quản trị telemetry chỉ bind loopback: Collector OTLP/HTTP `4318`, Prometheus `9095`, Tempo `3205`. Không mở các cổng này ra Internet.

Nếu backend chạy bằng Node trên máy, chỉ khởi động kho telemetry:

```powershell
docker compose -p tripflix-observability -f deploy/compose.observability.yaml up -d
$env:OTEL_EXPORTER_OTLP_ENDPOINT='http://localhost:4318'
$env:ANALYTICS_PROMETHEUS_URL='http://localhost:9095'
$env:ANALYTICS_TEMPO_URL='http://localhost:3205'
```

Sau đó chạy backend theo README với biến database/Redis của môi trường đó. Admin dùng `ADMIN_CORE_API_URL` và `ADMIN_ORIGIN` hiện có. Đăng nhập bằng tài khoản superadmin; moderator và member nhận HTTP 403 ở API. Observability không thêm migration. Sau khi ghép AI usage từ BE #228, cần chạy `pnpm db:migrate` theo quy trình triển khai để tạo bảng `analytics.ai_usage_events`; không cần seed lại.

## Thu thập

- `libs/observability`: NodeSDK được khởi tạo trước app, server span cho mỗi HTTP request trừ `/health`, histogram `tripflix.http.server.duration` theo giây và nhãn route chuẩn hóa, method, HTTP status. Request bị ngắt ghi 499 và kết thúc span đúng một lần.
- Metric runtime: heartbeat, RSS và uptime. Resource chỉ giữ tên service và UUID của instance; không thu process arguments, username hay hostname. Cửa sổ heartbeat là 60 giây; RSS/uptime chỉ lấy instance còn gửi tín hiệu.
- Undici instrumentation tạo client span cho `fetch` có parent và truyền W3C trace context. Các truy vấn vào Collector/Prometheus/Tempo được bỏ qua để tránh tự tạo trace cho việc đọc telemetry. Không instrument SQL, Redis, Socket.IO, AI service, mobile, trình duyệt hay video-worker trong thay đổi này.
- Không thu body, cookie, Authorization, giá trị query hoặc path của request đi ra. Server chỉ ghi route template, ví dụ `/api/posts/:id`. Pino thêm `traceId`/`spanId` vào log trong context đang hoạt động; log vẫn nằm ở stdout, chưa có Loki hoặc giao diện tìm log.
- Không đặt endpoint Collector thì SDK không khởi động. Có thể tắt bằng `OTEL_SDK_DISABLED=true`. Đối với sampling trên production, dùng các biến chuẩn `OTEL_TRACES_SAMPLER=parentbased_traceidratio` và `OTEL_TRACES_SAMPLER_ARG`; metric request vẫn đo đầy đủ. Trace search phản ánh các trace được lấy mẫu, không dùng để tính tổng request.
- Nest shutdown hook chờ SDK flush các bản ghi còn trong bộ đệm.

## API và cách đọc số liệu

Tất cả endpoint dưới đây yêu cầu Bearer token superadmin và trả `Cache-Control: no-store`. Admin gọi chúng bằng client Orval đã sinh và BFF hiện có.

| Endpoint                                           | Bộ lọc                                                         | Kết quả                                             |
| -------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| `GET /api/analytics/observability`                 | `range=15m\|1h\|6h\|24h`, `service`                            | KPI, biểu đồ, heartbeat service, top 20 route       |
| `GET /api/analytics/observability/traces`          | như trên, `errorsOnly=true\|false`, `minDurationMs=0..3600000` | Tối đa 50 trace khớp điều kiện                      |
| `GET /api/analytics/observability/traces/:traceId` | Trace ID hex 32 ký tự                                          | Các span đã lọc thuộc tính, timeline và HTTP status |

- Số request dùng PromQL `increase`: là ước tính từ counter và có thể có phần thập phân. Tổng request và tỷ lệ 5xx theo khoảng đã chọn; tốc độ, p50/p95 và biểu đồ dùng cửa sổ trượt 5 phút. Percentile chung được tính từ bucket gộp, không lấy trung bình percentile từng service.
- Collector export/batch và Prometheus scrape mỗi khoảng 15 giây; thường cần 30–60 giây cùng ít nhất hai mẫu để có rate/percentile. Thiếu mẫu trả `null`, không thay bằng 0. Khoảng thiếu mẫu ngắt đường biểu đồ.
- API cache tổng quan trong 15 giây, gộp các lần gọi đồng thời; admin tự cập nhật mỗi 30 giây, dừng polling nền. Cache có giới hạn 64 khóa. Timeout upstream 8 giây và giới hạn response 4 MiB.
- Trạng thái nguồn: `ready` (truy vấn thành công, có thể chưa có mẫu), `not_configured`, `unavailable`. Lỗi upstream không trả URL/khoá hay nội dung lỗi nội bộ. Heartbeat chỉ cho biết tiến trình đang gửi telemetry, không thay thế health check database/Redis.
- Tempo có thể lược số 0 đầu Trace ID trong kết quả search; API thêm lại đủ 32 ký tự. Span ID dạng base64 được đổi về hex để đối chiếu log.

## Lưu trữ và giới hạn

Danh sách trace mặc định loại `trace:rootName = "OPTIONS CORS preflight"` ngay trong truy vấn Tempo, trước giới hạn 50 kết quả. Đặt `includeSuccessfulPreflights=true` để xem lại. Middleware chỉ đặt tên này khi OPTIONS có Origin, Access-Control-Request-Method, HTTP 2xx và response cho phép origin/method/header tương ứng. Trace lỗi, OPTIONS thường và trace cũ chưa phân loại vẫn hiện. Không lưu giá trị header CORS; metric và trace vẫn được thu, tra cứu trực tiếp bằng ID không bị lọc. Cần triển khai lại service dùng `libs/observability` để phân loại request mới.

Prometheus giữ tối đa 7 ngày hoặc 2 GB, Tempo giữ 48 giờ. Cả hai dùng Docker named volume. Collector chỉ có hàng đợi RAM; nếu Collector dừng, có thể mất dữ liệu đang chờ. Cấu hình này là một node cho local/staging; cần cấu hình lưu trữ bền và vận hành phù hợp trước khi dùng cho production nhiều replica.

Đổi source code không tự cập nhật môi trường đã triển khai. Cần build/deploy image mới và áp dụng overlay. Với compose server, dùng `compose.server.yaml` làm file gốc thay cho `compose.yaml` sau khi review cấu hình môi trường; không chạy lệnh local trên production theo mặc định.

## Kiểm tra

```powershell
pnpm turbo run lint typecheck test --affected
pnpm --filter @tripflix/observability test
pnpm --filter @tripflix/core-api exec vitest run src/modules/analytics
```

Ở repo frontend, script `tests/e2e/admin/analytics.cjs` kiểm tra đăng nhập BFF thật, Prometheus thật, trace Tempo thật, bộ lọc, validation, trạng thái upstream lỗi và viewport 1440/390. Cấu hình `PLAYWRIGHT_PACKAGE`, `PLAYWRIGHT_CHANNEL`, `ANALYTICS_ADMIN_URL`, `ANALYTICS_EVIDENCE_DIR` theo môi trường. `ANALYTICS_TEST_EMAIL`/`ANALYTICS_TEST_PASSWORD` chỉ dùng tài khoản kiểm thử. Có thể đặt `ANALYTICS_TRACE_ID` để kiểm tra một trace nhiều service đã tồn tại.

Tham khảo API nguồn: [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/), [Tempo HTTP API](https://grafana.com/docs/tempo/latest/api_docs/), [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js).
