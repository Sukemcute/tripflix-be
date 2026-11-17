# @tripflix/observability

Log (pino) và distributed tracing (OpenTelemetry) dùng chung cho các service Node: core-api, notification-service, video-worker.

## Tracing (TF99)

Một bộ OpenTelemetry chung: `startTelemetry` (span HTTP, metric cho trang Analytics, xem `docs/observability.md`). Mặc định **tắt**: không đặt `OTEL_EXPORTER_OTLP_ENDPOINT` thì không nạp SDK, không tốn gì.

Muốn thấy thêm **từng câu SQL và lệnh Redis** thì nạp qua `--import` để bật SDK **trước** app (service là ESM, hook phải đăng ký trước khi app import `pg`, `ioredis`). App gọi `startTelemetry` sau đó nhận lại đúng SDK này, không tạo cái thứ hai. Không sửa code hay Dockerfile của app, chỉ đặt biến môi trường:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=core-api \
NODE_OPTIONS="--import @tripflix/observability/register" \
node dist/main.js
```

Đo được: request HTTP (middleware `createTelemetryMiddleware`), gọi ra ngoài (`fetch`), từng câu SQL (`pg`), lệnh Redis (`ioredis`); `traceId`, `spanId` gắn vào mỗi dòng log pino. Có `--import` thì nên đặt `OTEL_SERVICE_NAME`; không đặt thì lấy tên thư mục app.

### Riêng tư
- Câu SQL chỉ có `$1, $2`, **không ghi giá trị tham số** (nội dung bình luận, email không lọt vào trace).
- Lệnh Redis chỉ ghi **tên lệnh**, không ghi khoá, giá trị (khoá phiên, token).
- Không ghi header, body HTTP.
- `pg`, `ioredis` chỉ tạo span khi đang trong một request: job nền (outbox relay quét 500 ms) không sinh trace rác.

### Xem trace ở local (Jaeger)

```bash
docker run -d --name tripflix-jaeger -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:2.10.0
# chạy service với các biến ở trên, gọi vài request, mở http://localhost:16686
docker rm -f tripflix-jaeger   # xong thì xoá
```

### Bật trên server
Đặt thêm sampling, **không trace 100%**: `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.1` (10%). Endpoint là collector OTLP (HTTP) của môi trường đó.

### Chưa làm (bước 2)
Truyền trace qua outbox sang notification-service: thêm `traceparent` (tuỳ chọn) vào envelope, writer ghi context hiện tại, consumer mở span con.
