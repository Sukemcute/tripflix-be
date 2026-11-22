# TF32 / BE-09 đợt 2 — bằng chứng khung hình video

19/11/2026, nhánh `trang/TF32-be09-khung-hinh` từ develop sau BE #297.

## Triển khai

- `media_frame_scans` lưu một job theo asset, revision và `uniform-v1`; outbox chuyển yêu cầu sang `stream:media`. Manifest có đúng các timestamp và key của request; Core bỏ qua kết quả đến muộn hoặc sai revision.
- Worker Go trên staging và worker TypeScript local trích tối đa 24 JPEG, cạnh dài 640 px, video tối đa 5 phút, source tối đa 1 GiB, frame tối đa 1 MiB. Lỗi trích ảnh không đổi trạng thái phát video; sau ba lần giao lỗi trả `media.frames.failed`.
- Caption, poster và từng frame là đầu vào AI riêng. Verdict ảnh chỉ tạo hồ sơ review; frame giữa bị gắn cờ vẫn giữ bài published. Staff thấy coverage, timestamp, lỗi và có thể thử lại job thất bại.

## Kiểm tra

- Core: 156 integration tests content, 3.023 unit tests; contracts 27 tests; typecheck và ranh giới module qua.
- TypeScript worker: 53 unit tests, 8 Redis integration tests; typecheck/lint qua. Kiểm tra giới hạn source cả khi metadata kích thước không đáng tin.
- Go worker: `go test ./...` và Redis integration qua. Test FFmpeg thật trên clip xanh–đỏ–xanh 6 giây xác nhận ảnh giữa 2,950 giây đỏ, hai mép xanh.
- Bộ FFmpeg cũ toàn phần có một lỗi môi trường tại `TestFFmpegThatVideoXoay90Do60fpsKhongTieng`: FFmpeg 5.1.9 thiếu `-display_rotation`; test frame mới qua riêng.
- Nghiệm thu Core/Redis/OpenAI/Admin local qua fixture FFmpeg; xem báo cáo tổng ở workspace `docs/moderation/10-be09-dot2-khung-hinh-video.md`.

## Triển khai

Áp migration và đưa worker mới lên trước Core để worker cũ không ACK một event frame chưa biết. FE sau Core. Upload S3/CloudFront thật chưa thử vì môi trường thiếu AWS credentials; OCR/ASR ngoài phạm vi đợt này.
