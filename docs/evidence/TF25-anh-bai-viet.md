# TF25 — Bài viết kèm ảnh (BE)

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-anh-bai-viet` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-13

## Bối cảnh
Web chỉ đăng được video (Reels). Bài viết (vlog) không kèm được ảnh nào. BE cũng chưa nhận ảnh:
- `media_assets` chỉ nhận `video/mp4`, `video/quicktime`.
- Social chặn mọi media trên bài viết (`assertMediaAllowedForPostType`).

Anh Thành chọn hướng mở rộng `media_assets` (module media, anh Phong phụ trách) thay vì làm bảng ảnh riêng.

## Đã làm
### Module media (anh Phong)
- **Migration `20261113090238_media_assets_image_kind`**, chỉ thêm hoặc nới, bản ghi cũ giữ nguyên nghĩa:
  - Cột `kind` (`video` | `image`, mặc định `video`), `width_px`, `height_px`.
  - `duration_sec` bỏ NOT NULL.
  - Viết lại 3 ràng buộc theo `kind`: loại MIME, thời lượng, ready phải có HLS. Riêng ràng buộc thời lượng ghi rõ `duration_sec is not null` cho video, vì với `NULL` thì `> 0` cho ra NULL và CHECK coi là đạt. Lỗ này do integration test phát hiện.
- **Upload ảnh dùng lại 3 API `media/uploads` có sẵn:**
  - Nhận JPEG, PNG, WebP tối đa 10 MB, không gửi `durationSec`, có thể gửi `widthPx`/`heightPx`.
  - Ảnh đúng một phần upload.
  - Khoá S3 là `images/posts/<id>.<đuôi>`, cùng nhánh `images/` với ảnh khách sạn.
- **Hoàn tất ảnh:** ghép file, kiểm dung lượng, đọc 12 byte đầu để chắc đúng định dạng đã khai (`detectImageMimeType`), rồi `ready` ngay.
  - Không ghi sự kiện chuyển mã, video-worker không nhận ảnh.
  - Sai định dạng: `failed` và lỗi `MEDIA_INVALID_IMAGE` (422).
- **`MediaFacade`** thêm `getImages` (link CDN, kích thước, chỉ ảnh ready) và `getKinds`.
- **`getPlayback` (Reels) không đổi.** Hàm này chỉ trả bản ghi có mức chất lượng, nên ảnh không bao giờ lên Reels.
- Luồng video giữ nguyên. Trường `kind` tuỳ chọn khi tạo bản ghi (mặc định video), nên test cũ của module media không phải sửa.

### Social (Thành)
- **Luật mới, kiểm trong use case tạo nháp, sửa và xuất bản qua `PostMediaPort` (nối với `MediaFacade`):**
  - Bài viết kèm tối đa 10 ảnh; ảnh phải của chính tác giả và đã tải xong.
  - Bài viết vẫn cấm video, kể cả bản nháp cũ đã lỡ gắn video.
  - Reels không kèm ảnh.
- **API trả `images: [{ id, url, widthPx, heightPx }]`** theo thứ tự `mediaIds` ở: tạo nháp, sửa bài, danh sách bài, bài của tôi, chi tiết bài, bài đã lưu (`PostImagesResolver`, một lần hỏi media cho cả trang).
- Request không đổi: vẫn dùng `media_ids`, `cover_media_id` có sẵn.
- `pnpm contracts:build`: chỉ thêm hoặc nới (MIME ảnh, `durationSec` tuỳ chọn, `widthPx`/`heightPx`, `images`, lỗi 422).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Tải ảnh JPEG/PNG/WebP ≤ 10 MB lên, dùng được ngay | Có | `media-image-upload.use-cases.spec.ts` (6 test); `drizzle-media-image.int.spec.ts` › tải ảnh lên, hoàn tất thì ready (Postgres thật) |
| File giả dạng ảnh bị từ chối | Có | `media-image-upload.use-cases.spec.ts` › file không đúng định dạng / khai PNG mà là JPEG |
| Video và Reels không bị ảnh hưởng | Có | Test media cũ pass nguyên; int › ảnh không có trong `getPlayback`; int › bản ghi video cũ mặc định `kind = video`, video thiếu thời lượng vẫn bị chặn |
| Bài viết kèm ≤ 10 ảnh của chính mình; cấm video; Reels cấm ảnh | Có | `post.entity.spec.ts` › assertMediaKindsForPostType; `post-images.spec.ts` › tạo/sửa/xuất bản |
| API trả ảnh đúng thứ tự | Có | `post-images.spec.ts` › PostImagesResolver |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49 task.
  - Lần đầu, 2 bộ e2e không khởi tạo kịp khi máy đang tải nặng: `media-upload.e2e.spec.ts` (anh Phong) và `moderation.e2e.spec.ts` (Trang).
  - Chạy riêng 2 bộ đó: 36/36 pass. Chạy lại cả core-api: 2352 pass, 1 skipped có sẵn.
  - Lint 0 lỗi, không có warning mới ở file đã sửa.
- `pnpm --filter @tripflix/core-api test:int src/modules/content/media`: 12/12 pass (Testcontainers Postgres).
- Chưa kiểm với S3 và CDN thật: cần chạy migration và khởi động lại BE local từ nhánh này. Xem "Cách kiểm lại".

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api build && pnpm --filter @tripflix/core-api db:migrate`, khởi động lại core-api.
2. Trên web, mở form đăng bài, chọn Bài viết, thêm 2–3 ảnh. Từng ảnh chạy tiến độ rồi xong.
3. Đăng bài: thẻ bài ở tab Bài viết hiện đúng ảnh và đúng thứ tự. `GET /api/v1/posts/<id>` có `images` với link CDN `.../images/posts/<id>.jpg` mở được.

## Ảnh / video
- Không đính kèm (theo yêu cầu).

## Ảnh hưởng tới phần của người khác
- **Module media, `content/media` (anh Phong):**
  - Sửa `upload-rules`, `dto`, `http`, `controller`, `use-cases`, `ports`, cả hai store và `media.facade`.
  - Thêm loại lỗi `MEDIA_INVALID_IMAGE`.
  - Hành vi video không đổi.
  - Anh Thành đã chọn hướng này; cần anh Phong review.
- **`content/db` (anh Phong, Thành, Trang):** migration mới chỉ thêm cột và viết lại ràng buộc của `media_assets`.
- **CDN:** ảnh đọc thẳng ở `images/posts/`. Cần xác nhận CloudFront phục vụ nhánh này như `images/hotels/`.
- **CORS của bucket:** web PUT thẳng lên S3. Upload video từ web đang chạy được nên CORS đã mở.
