# @tripflix/observability

Log (pino) và distributed tracing (OpenTelemetry) dùng chung cho các service Node: core-api, notification-service, video-worker.

## Tracing (TF99)

Mặc định **tắt**: không đặt `OTEL_EXPORTER_OTLP_ENDPOINT` thì không nạp SDK, không tốn gì.

Service là ESM nên tracing phải nạp **trước** app (để kịp bọc `pg`, `ioredis`, `express`), qua `--import`. Không sửa code hay Dockerfile của app, chỉ đặt biến môi trường:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=core-api \
NODE_OPTIONS="--import @tripflix/observability/register" \
node dist/main.js
```

Đo được: request HTTP (Express, Nest), từng câu SQL (`pg`), lệnh Redis (`ioredis`); `trace_id`, `span_id` gắn vào mỗi dòng log pino.

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
Đặt thêm sampling, **không trace 100%**: `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.1` (10%). Endpoint là collector OTLP (HTTP, protobuf) của môi trường đó.

### Chưa làm (bước 2)
Truyền trace qua outbox sang notification-service: thêm `traceparent` (tuỳ chọn) vào envelope, writer ghi context hiện tại, consumer mở span con.
