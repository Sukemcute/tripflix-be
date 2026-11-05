# TF09 — Phần 8: video-worker chuyển mã sang HLS

- Task: TF09 (SCRUM-13) · Nhánh: `phong/TF09-video-worker` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-05

PR này là một phần của TF09. Worker đã tạo được HLS phát qua CloudFront, nhưng video vẫn ở `processing` cho tới khi có phần nhận kết quả ở `core-api` và API phát.

## Đã làm
- Worker đọc `content.media.transcode_requested` từ `stream:media` bằng `RedisStreamsConsumer` của `libs/event-bus`, group `video-worker`, mỗi worker làm một việc.
- Tải file gốc, đọc thông số bằng `ffprobe`, tạo 3 ảnh bìa, làm từng mức từ thấp lên cao. Mỗi mức xong thì ghi lại `master.m3u8` rồi phát `media.rendition.completed`, để video đăng được sớm ở 360p.
- Không phóng to quá video gốc, nhưng luôn có 360p.
- Đọc thông tin xoay, vì điện thoại quay dọc thường lưu video ngang kèm góc xoay. Hỗ trợ video không có tiếng. Giới hạn 30 khung hình/giây để khớp bitrate và codec khai trong master.
- Bỏ metadata của file gốc, vì có thể chứa vị trí GPS mà file HLS thì công khai.
- Cứ 30 giây gọi `XCLAIM ... JUSTID` để việc lâu không bị worker khác nhận lại. Việc treo quá 2 phút thì được nhận lại.
- Lỗi thì không XACK. Sau 3 lần giao thì phát `media.transcode.failed` kèm mức lỗi rồi XACK.
- Giao lại việc: mức đã có `index.m3u8` thì không làm lại, chỉ báo lại, vì lần trước có thể đã chết trước khi báo. `index.m3u8` được ghi sau cùng nên có nó nghĩa là đủ các đoạn.
- Tắt worker thì dừng FFmpeg, không XACK và không báo lỗi, để việc được giao lại.
- Thêm schema `media.rendition.completed`, `media.transcode.failed` vào `libs/contracts`. Không thêm thư viện ngoài.

## Đối chiếu tài liệu (docs/10 §5.2, §5.3)
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bố cục `videos/{assetId}/r{n}/`, 3 ảnh bìa | Có | Thử thật; `transcode-job.spec.ts` |
| Làm 360p trước, master chỉ có mức đã xong | Có | `khi báo xong 360p thì đã có ảnh bìa...` |
| Master cache 60 giây, còn lại không đổi | Có | Thử thật qua CloudFront |
| Đoạn cuối từ 0,5 giây | Có | Thử thật; `đoạn cuối quá ngắn thì coi là lỗi...` |
| Báo còn sống, không tăng số lần giao | Có | Int test `đang làm lâu thì báo còn sống...` trên Redis thật |
| Thử tối đa 3 lần rồi báo lỗi | Có | Int test `lỗi thì không XACK...` trên Redis thật |
| 360p xong mà mức cao lỗi thì giữ 360p | Có | Int test `360p xong mà mức cao lỗi...` |
| Giao lại không chuyển mã lại | Có | `giao lại khi đã xong hết...`; thử thật |

## Kết quả kiểm tra
Chạy đủ các bước của CI, tất cả thoát mã 0:
- `pnpm lint` (có kiểm ranh giới module): 22/22 task.
- `pnpm typecheck`: 22/22 task.
- `pnpm test`: 22/22 task; video-worker 49/49 test.
- `pnpm test:int`: 15/15 task; video-worker 6/6 test trên Redis thật.
- `pnpm build`: 13/13 task.
- `pnpm contracts:build`: thêm 2 schema sự kiện, đã commit.

Thử thật với FFmpeg 9.0.2 trên máy, S3 `dev/phong/`, CloudFront và Redis local: 38/38 đạt, đã dọn dữ liệu thử.
- Video dọc 540x960 có tiếng: ra 360p, 540p.
- Video 1280x720 xoay 90 độ, không tiếng, 60 khung hình/giây: ra 360p, 540p, 720p đúng chiều dọc, 30 khung hình/giây.
- `ffprobe` đọc HLS qua CloudFront và `ffmpeg` giải mã hết mức 360p không lỗi. File gốc vẫn bị chặn (403).
- Giao lại việc đã xong: báo lại đủ các mức, mất khoảng 60 giây vì phải tải lại file gốc qua mạng chậm.
- `SIGTERM`: worker thoát sạch. File hỏng: `ffprobe` báo lỗi. Huỷ giữa chừng: FFmpeg dừng ngay, không còn tiến trình.

## Chưa làm, giới hạn
- Phần nhận kết quả ở `core-api` và API phát chưa có, nên trạng thái chưa thành `ready`.
- CI không cài FFmpeg nên test trên CI dùng bản giả. FFmpeg thật chỉ thử trên máy, bản trong Docker image có thể khác phiên bản.
- Chưa thử trên điện thoại thật và chưa thử video HDR của iPhone; video HDR có thể bị nhạt màu.
- Chưa thử nhận lại việc khi worker chết thật, mới thử bằng lỗi giả và thời gian chờ ngắn trên Redis thật.

## Cách kiểm lại
1. `pnpm install && pnpm build`.
2. `pnpm --filter @tripflix/video-worker test`.
3. `pnpm --filter @tripflix/video-worker test:int`, cần Docker.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `libs/contracts` của Dũng thêm 2 schema và 2 hằng số, tương thích ngược.
