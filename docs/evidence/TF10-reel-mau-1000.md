# TF10 — 1000 reel mẫu từ 60 video, 400 bài có lộ trình đặt được

- Notion: <dán link task TF10> · Nhánh: `thang/TF10-du-lieu-khach-san-x10` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- **60 video của Duy lên S3**: tải qua đúng API media của core-api (`POST /api/media/uploads` → PUT từng phần → `complete`), video-worker chuyển HLS 360p, 540p, 720p vào `dev/thang/videos/<id>/r1/`. Cả 60 video `ready`, 9:16, 23–37 giây.
- **`db/seed/reels/`** (content, chỉ thêm file mới):
  - `reel-videos.json`: 60 video (HLS, thời lượng, mức chất lượng) kèm tiêu đề, nơi, kịch bản, mẹo, ngân sách Duy dựng; 49 video trong nước gắn điểm đến, 11 video nước ngoài không gắn.
  - `reel-destinations.ts`: 27 điểm đến → tỉnh có khách sạn trong catalog commerce (lọc thêm theo tên khi tỉnh đã gộp, ví dụ Hà Giang trong Tuyên Quang), sân bay gần nhất, chặng xe từ sân bay.
  - `reel-stops.json`: 486 quán ăn, quán cà phê, chỗ chơi có thật cho 27 điểm đến (Codex soạn, Claude soát; 2 quán Mù Cang Chải không chắc tên đã đổi sang tên mô tả).
  - `generate-reels.ts`: bộ sinh tất định (cùng đầu vào ra cùng dữ liệu), sinh lúc seed nên không lưu 1000 bài trong git.
- **1000 reel** chia cho 200 tài khoản `loadtestNNNN@tripflix.local` (có sẵn trên server từ TF07), mỗi tài khoản ít nhất 1 bài, vài người đăng nhiều. Mỗi bài một dòng `media_assets` riêng (chủ là người đăng) trỏ vào HLS dùng chung của 1 trong 60 video, mỗi video 16–17 bài, hai bài cùng video cách nhau ít nhất 15 bài trên feed.
- Nội dung giống bài reel trên develop (`postType: video`, tiêu đề, nội dung, hashtag, đếm cảm xúc, bình luận, lưu, chia sẻ, ngày đăng rải 120 ngày); **không trùng tiêu đề, không trùng nội dung**. `isVerified = false`, `bookingId` để trống vì không có đơn thật.
- **400 bài có lộ trình**, mỗi lộ trình 1–5 điểm đặt được trên Tripi: khách sạn (`hotel { hotelId, productId, ratePlanCode }` có thật trong catalog) và chặng bay (`fromAirport`, `toAirport` có chuyến trong catalog). Xen giữa là quán ăn, cà phê, chỗ chơi và chặng xe tự túc, không gắn khách sạn hay chuyến bay. Giờ trong ngày hợp lý: bay sáng, đi xe tới rồi mới nhận phòng, ngày cuối đi xe ra sân bay trước chuyến bay về.
- Tương tác thật: 23.130 cảm xúc, 4.096 bookmark, 4.453 bình luận (có trả lời), không ai tự thả tim bài mình.
- Lịch từng ngày: không ngày trống (hết quán thì lấy loại khác, cuối cùng là "Tự do khám phá"), ngày cuối luôn có trả phòng nên số ngày khớp `daysCount`, không trùng giờ, chợ phiên chỉ xếp buổi sáng.
- **Seed lại an toàn** (`seedReels`): xoá cảm xúc, bookmark, bình luận mẫu cũ theo dải id của seed rồi nạp lại, đặt lại người đăng và chủ video. Thêm video hoặc đổi bộ sinh rồi seed lại server không bị lỗi trùng (bài, người), không xoá tương tác của người dùng thật.
- `seed-content.ts`: thêm `seedContentData(db, seed)` để nạp dữ liệu sinh trong bộ nhớ; `seedContent(db, file)` giữ nguyên chữ ký và hành vi. `cli/seed.ts`: tìm 200 tài khoản load test, có thì sinh reel mẫu, không có thì bỏ qua.

## Đối chiếu yêu cầu
| Yêu cầu | Đạt | Bằng chứng |
|---|---|---|
| 60 video lên S3, phát được | Có | 60/60 `ready`; `master.m3u8`, playlist từng mức, `poster_540.jpg` qua CloudFront đều 200 |
| 1000 bài, chia 200 tài khoản, lặp lại 60 video | Có | `generate-reels.spec.ts`; DB local: 1000 bài, 200 người đăng, 60 `hls_prefix` |
| Trường nội dung như reel trên develop | Có | Cùng kiểu `ContentSeed`, nạp bằng cùng code seed; feed `/api/v1/feed` trả đủ thẻ |
| 1000 bài không trùng nội dung | Có | test: 1000 tiêu đề khác nhau, 1000 nội dung khác nhau |
| 400 bài có lộ trình, 1–5 điểm Tripi đặt được | Có | test: đủ 1, 2, 3, 4, 5 điểm; khách sạn, loại phòng, gói giá, tuyến bay đều có trong catalog |
| Xen quán ăn, cà phê, chỗ chơi không gắn link | Có | test: mỗi lộ trình có điểm không gắn khách sạn, chuyến bay |
| Chạy lại không tạo trùng | Có | Chạy `pnpm db:seed` 2 lần, số dòng giữ nguyên |
| Seed lại sau khi dữ liệu sinh đổi | Có | `reel-seed.int.spec.ts` (Postgres thật): cách nạp cũ lỗi `idx_reactions_post_user`, cách mới qua; giữ cảm xúc của người dùng thật, người đăng khớp dữ liệu mới |
| Lịch trình hợp lý | Có | test: không ngày trống, đúng `daysCount`, không trùng giờ, chợ phiên buổi sáng; soát cả 1000 bài bằng script: không lỗi |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 48/49 task; core-api 2710 test qua, 2 lỗi, 4 bỏ qua. 2 lỗi có sẵn trên develop, không liên quan (`comment.entity.spec.ts`, `post-summary-and-flat-comments.spec.ts`, giới hạn bình luận 2.000 ký tự).
- `pnpm turbo run build test:int --affected`: 19/19.
- `generate-reels.spec.ts`: 7/7; `reel-seed.int.spec.ts`: 1/1.
- Chạy thật local (Postgres, Redis, core-api, video-worker): `pnpm db:seed` khoảng 3 phút, in "reel mẫu: 1000 bài của 200 tài khoản load test, 4453 bình luận, 23130 cảm xúc, 4096 bookmark"; seed lại trên dữ liệu bản trước cũng qua. Lướt hết `/api/v1/feed` (51 trang): 1008 thẻ, đủ 1000 reel mẫu, 400 thẻ có lộ trình, không trùng.

## Cách kiểm lại
1. Có tài khoản load test: `LOADTEST_PASSWORD=<mật khẩu> node tools/loadtest/gen-users-sql.mjs 200`, chạy SQL vào database access.
2. `pnpm --filter @tripflix/core-api build && pnpm --filter @tripflix/core-api db:seed`.
3. `GET /api/v1/feed?limit=20`: thẻ `018da020-…` là reel mẫu, `tripAttachment.items` có `hotel` hoặc `transport.mode = flight` là điểm đặt được.

## Lưu ý
- Video nằm ở `dev/thang/videos/` (CloudFront đọc `dev/*/videos/*`). File gốc ở `dev/thang/uploads/` tự xoá sau 7 ngày theo lifecycle, không ảnh hưởng HLS.
- Video của Duy đã in sẵn chữ (KOC, "Verified", tiêu đề, mẹo) nên các bài cùng video hiện chữ giống nhau trên hình; caption, người đăng, lộ trình mỗi bài vẫn khác nhau.
- Ảnh trong video lấy từ Wikimedia Commons, bộ dựng video của Duy chưa lưu tác giả, giấy phép.
- Trên server: tài khoản load test đang có tên "Load test N".

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- `content/db/seed` (Phong, Thành, Trang): thêm thư mục `reels/` và hàm `seedContentData`; không sửa dữ liệu, hành vi 10 bài seed cũ.
- `cli/seed.ts`: đọc thêm id tài khoản load test trong `access` (Dũng), chỉ đọc, không tạo hay sửa tài khoản.
- Feed (Phong) và gợi ý (Duy) sẽ có thêm 1000 bài sau khi seed server.
