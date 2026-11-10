# video-worker viết lại bằng Go

- Task: viết lại `video-worker` theo việc mentor giao (07/11) · Nhánh: `phong/video-worker-go` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-09

PR này thêm bản Go ở `apps/video-worker-go`, chạy song song với bản TypeScript. Server và máy dev vẫn chạy bản TypeScript. Chưa sửa CI, `publish.yml`, compose: các phần này chờ Tech Lead đồng ý.

## Đã làm
- Viết lại đủ các phần của worker:
  - đọc `content.media.transcode_requested` bằng consumer group `video-worker`;
  - nhận lại việc treo quá 2 phút, chuyển dead-letter;
  - cứ 30 giây báo còn sống;
  - tải file gốc, đọc thông số bằng `ffprobe`, tạo 3 ảnh bìa, làm từng mức từ thấp lên cao;
  - ghi lại master sau mỗi mức, báo `media.rendition.completed` từng mức, báo `media.transcode.failed` sau 3 lần lỗi.
- Giữ nguyên tên sự kiện, payload, bố cục file trên S3, `Cache-Control`, tham số FFmpeg và biến môi trường. `core-api` và app không phải đổi gì.
- Khác bản TypeScript:
  - đọc file thẳng từ đĩa khi tải lên S3;
  - giới hạn mỗi việc 30 phút, đổi bằng `VIDEO_WORKER_JOB_TIMEOUT`;
  - payload sai định dạng thì vào dead-letter ngay.
- Thư viện ngoài: `go-redis`, AWS SDK v2, `x/sync`.

## Kết quả kiểm tra
- `go vet ./...`: không lỗi.
- `go test -race ./...`: 36 test qua, chuyển từ test của bản TypeScript và thêm test đọc sự kiện.
- `TEST_REDIS_URL=... go test -race -p 1 ./...`: thêm 8 test qua trên Redis 8.8 thật:
  - báo kết quả từng mức rồi XACK;
  - bỏ qua sự kiện khác;
  - lỗi 3 lần thì báo `failed`;
  - 360p xong mà mức cao lỗi thì giữ 360p;
  - báo còn sống khi làm lâu;
  - tắt giữa chừng thì không XACK;
  - payload sai thì vào dead-letter;
  - quá thời gian thì tính là lỗi.
- FFmpeg 9.0.2 thật trên máy, 2 test qua:
  - video dọc 540x960 có tiếng ra 360p và 540p đúng kích thước, giải mã hết 360p không lỗi;
  - video 1280x720 xoay 90 độ, 60 khung hình/giây, không tiếng, ra 3 mức dọc ở 30 khung hình/giây.
- So với bản TypeScript trên cùng lưới đầu vào:
  - lưới gồm 18 kích thước, 10 thời lượng, có và không tiếng, 4 kết quả ffprobe có góc xoay;
  - phần so gồm tham số FFmpeg, master playlist, kích thước, aspect và đọc ffprobe;
  - kết quả: 364/364 dòng giống nhau.

## Đo so với bản TypeScript

| | TypeScript | Go |
|---|---|---|
| Image prod | 981 MB | 721 MB |
| File chạy | Node 24 và `node_modules` | 1 file 12 MB |
| RAM lúc chờ việc, đo bằng `docker stats` 3 lần | 75 MB | 4 MB |
| FFmpeg trong image | 5.1 (Debian bookworm) | 5.1 (Debian bookworm) |

- Image TypeScript đem đo build ngày 05/11. Code worker từ đó tới nay không đổi.
- Phần lớn dung lượng image là FFmpeg của Debian, nên bỏ Node chỉ giảm khoảng 260 MB.

## Chưa làm, giới hạn
- Chưa chạy cả quy trình với S3 thật, nên chưa so RAM và thời gian lúc đang chuyển mã. Thời gian chủ yếu do FFmpeg nên dự kiến gần như nhau.
- CI chưa chạy test Go. `publish.yml` chưa build image Go. `compose.yaml` và `compose.server.yaml` chưa có service. Cả ba là phần của Tech Lead.
- Chưa gộp lần chạy FFmpeg của các mức. Mỗi mức vẫn đọc lại file gốc, giống bản TypeScript.
- Không chạy cùng lúc hai bản trên cùng Redis, vì chung group `video-worker`.

## Cách kiểm lại
1. `cd apps/video-worker-go && go test -race ./...`
2. `docker run -d --rm --name vw-test-redis -p 127.0.0.1:6390:6379 redis:8.8-alpine`
3. `TEST_REDIS_URL=redis://localhost:6390/15 go test -race -p 1 ./...`
4. `docker build -f apps/video-worker-go/Dockerfile --target prod .`

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Thư mục mới, không sửa code hay cấu hình chung.
