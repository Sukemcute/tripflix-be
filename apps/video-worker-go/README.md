# video-worker (Go)

Bản Go của `apps/video-worker`, viết lại theo yêu cầu của mentor. Hai bản chạy song song cho tới khi đo xong và chốt chuyển; bản TypeScript vẫn là bản đang chạy.

Worker chuyển mã video sang HLS: nhận `content.media.transcode_requested` từ `stream:media` (group `video-worker`), ghi file vào `videos/{assetId}/r{revision}/` trên S3, rồi báo `media.rendition.completed` cho từng mức, hoặc `media.transcode.failed` khi lỗi quá 3 lần.

## Giữ nguyên so với bản TypeScript

`core-api` và app không phải đổi gì:

- Cùng tên sự kiện, cùng payload, cùng consumer group, cùng stream dead-letter.
- Cùng bố cục file trên S3, cùng `Cache-Control` và `Content-Type`.
- Cùng tham số FFmpeg và nội dung `master.m3u8`. Đã so 364 trường hợp, giống hệt nhau (mục So với bản TypeScript).
- Cùng biến môi trường: `REDIS_URL`, `AWS_REGION`, `S3_MEDIA_BUCKET`, `S3_KEY_PREFIX`, `VIDEO_WORKER_CONSUMER_NAME`, `LOG_LEVEL`, `NODE_ENV`.
- Cùng cách chạy việc:
  - mỗi worker làm một việc;
  - cứ 30 giây báo còn sống;
  - việc treo 2 phút thì worker khác nhận lại;
  - giao lại việc thì không làm lại mức đã xong;
  - tắt worker thì dừng FFmpeg và không XACK.

## Khác bản TypeScript

| Thay đổi | Lý do |
|---|---|
| Tải file gốc và tải đoạn HLS lên S3 bằng cách đọc thẳng từ đĩa | Bản TS đọc cả đoạn vào RAM trước khi gửi. |
| Thêm giới hạn thời gian mỗi việc, `VIDEO_WORKER_JOB_TIMEOUT` (mặc định `30m`) | FFmpeg treo thì worker vẫn báo còn sống, nên việc bị giữ mãi. Quá giờ thì tính là một lần lỗi. |
| Payload `transcode_requested` sai định dạng thì vào `stream:dead-letter` ngay | Bản TS thử lại 5 lần dù không bao giờ thành công. |
| Log dùng `log/slog`: JSON khi `NODE_ENV=production`, dạng chữ khi chạy máy local | Thư viện chuẩn của Go. Trường `msg` giống pino, `level` ghi chữ (`INFO`) thay vì số. |
| Không tự đọc file `.env` | Chạy máy local thì nạp biến trước, xem mục Chạy trên máy. |

## Cấu trúc

```
cmd/video-worker/        khởi động: đọc cấu hình, nối Redis, S3, chạy worker, dừng khi nhận SIGTERM
internal/config/         biến môi trường
internal/events/         đọc, tạo sự kiện đúng schema của libs/contracts
internal/streams/        Redis Streams: consumer group, nhận lại việc treo, dead-letter, báo còn sống
internal/storage/        S3 và bản lưu trong bộ nhớ cho test
internal/transcode/      chọn mức, tham số FFmpeg, playlist, các bước của một việc
internal/worker/         nối consumer với việc chuyển mã, báo kết quả
```

## Chạy test

```sh
cd apps/video-worker-go
go test ./...            # unit test; có ffmpeg trên máy thì chạy cả test FFmpeg thật
go test -short ./...     # bỏ qua FFmpeg thật

# Test trên Redis thật, dùng database 15 và xoá sạch nó trước mỗi test
docker run -d --rm --name vw-test-redis -p 127.0.0.1:6390:6379 redis:8.8-alpine
TEST_REDIS_URL=redis://localhost:6390/15 go test -race -p 1 ./...
```

## Chạy trên máy

```sh
cd apps/video-worker-go
set -a; . ../video-worker/.env; set +a   # cùng biến với bản TypeScript; key AWS nằm trong biến AWS_*
go run ./cmd/video-worker
```

Không chạy cùng lúc với bản TypeScript trên cùng Redis: hai bản chung group `video-worker` nên sẽ chia nhau việc.

## So với bản TypeScript

`internal/transcode/parity_test.go` in kết quả của các hàm tính toán cho một lưới đầu vào. Lưới gồm:

- 18 kích thước;
- 10 thời lượng;
- có tiếng và không tiếng;
- 4 kết quả ffprobe có góc xoay.

Đem so với kết quả bản TypeScript in ra trên cùng lưới, gồm tham số FFmpeg, master playlist, kích thước, aspect và đọc ffprobe. Ngày 2026-11-09, 364/364 dòng giống nhau.

## Docker

```sh
docker build -f apps/video-worker-go/Dockerfile --target prod -t video-worker-go .
```

Image dùng Debian bookworm như `node:24-slim` của bản TypeScript, nên FFmpeg cùng phiên bản.
