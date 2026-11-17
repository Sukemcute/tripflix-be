# Analytics — observability

- Yêu cầu: triển khai giao diện Analytics và dữ liệu backend thật cho metric/trace/OpenTelemetry.
- Nhánh: `trang/TFxx-analytics-observability`; chưa gắn mã task cụ thể. Ngày: 2026-11-16.
- Workspace riêng lấy từ `origin/develop`; không đổi các file đang sửa trong checkout gốc. Người dùng yêu cầu commit/push và mở PR vào develop ngày 2026-11-17; chưa triển khai staging/production.

## Đã làm

- Thêm module đọc Prometheus/Tempo với ba endpoint chỉ cho superadmin; bộ lọc được validate, giới hạn thời gian/kích thước upstream, cache có giới hạn và trạng thái lỗi rõ ràng.
- SDK cho core-api/notification-service: server spans, distributed fetch spans, metric request và runtime; correlation với Pino; không ghi body/token/query; chỉ giữ service/instance trong resource.
- Compose bổ sung Collector, Prometheus và Tempo, volume/retention/cổng loopback. Không thay cấu hình compose gốc, không đổi database/migration.
- Sinh lại OpenAPI để frontend sinh client; có hướng dẫn vận hành tại `docs/observability.md`.

## Kiểm tra

- Sau khi merge `origin/develop` ngày 2026-11-17 (`191232b`), sinh lại contracts thành công; lint/typecheck/test **49/49 tác vụ thành công**, core-api **2593 test pass**, 4 skip có sẵn; notification-service **122 test pass**.

- `pnpm turbo run lint typecheck test --affected`: **49 tác vụ thành công**; riêng core-api **2553 test pass**, 4 test skip có sẵn.
- Sau khi sửa chuẩn hóa Trace ID/Span ID: **12 test Analytics pass**, **3 test observability/log pass**.
- Build dependency/backend cho core-api và notification-service: **12 tác vụ thành công**.
- Kiểm tra HTTP thật: superadmin đăng nhập, đọc metric từ Prometheus, list/detail trace từ Tempo. Test Nest HTTP riêng xác nhận 401 khi thiếu/sai token và 403 cho member/moderator trên cả ba endpoint.
- Distributed tracing thật: `GET /notifications/me` → client fetch JWKS → `GET /.well-known/jwks.json` ở core-api; Tempo lưu **3 span cùng trace**, thuộc hai service.
- Kiểm tra scoped cuối: lint/typecheck **16 tác vụ thành công**; lint riêng module Analytics không có warning/error; **12 test Analytics pass** sau lần sửa cuối; core-api build lại thành công.
- Ảnh UI và test trình duyệt được ghi trong evidence frontend bên cạnh; `artifacts/distributed-trace.json` chứa 3 span thật đã lọc thuộc tính.

## Ảnh hưởng

- Phối hợp AI usage của Bảo: thay đổi này không thêm consumer, bảng hoặc migration analytics. Khi có ingest chung, gộp handler `ai.usage.recorded` vào consumer group `core-analytics` trên `stream:ai`, giữ chống trùng `eventId`; không chạy hai consumer với bộ handler khác nhau trong cùng group. PR AI usage chưa có link tại thời điểm đối chiếu.
- BE PR #226 (`thanh/TF99-opentelemetry-tracing`) cũng thêm bootstrap OpenTelemetry trong thư viện dùng chung. Cần thống nhất bootstrap trước khi merge cả hai; không bật thêm `--import @tripflix/observability/register` cùng NodeSDK khởi tạo trong PR này.

- Trang: module Analytics.
- Dũng: thư viện observability, startup/core platform, startup notification-service — chỉ bổ sung telemetry tùy chọn và shutdown hook; không đổi API hiện có.
- Phong: thêm file compose/config observability riêng; không sửa compose gốc/CI/Dockerfile.
- Frontend Thành: giao diện admin, i18n, BFF và client sinh — xem evidence trong repo frontend.

Log kiểm tra local nằm ngoài Git tại `../../../artifacts/`. Không commit ảnh vào repo. Chưa load-test hoặc kiểm tra trên staging/production; SQL/Redis span, kho log, browser/mobile/AI instrumentation và dashboard nghiệp vụ A15/B7 chưa thuộc phần triển khai này.
