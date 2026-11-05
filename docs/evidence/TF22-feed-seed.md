# TF22 — Seed có video phát được cho feed

- Task: TF22 · Nhánh: `phong/TF22-feed-seed` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-05

8 video trong seed cũ ghi `ready` nhưng link trên CloudFront trả 403, nên feed của database mới seed là danh sách trống.

## Đã làm
- Chạy 10 video mẫu qua luồng thật (upload, `complete`, `video-worker`, nhận kết quả). HLS nằm trên S3 `dev/phong/videos/`.
- `posts-seed.json`: giữ id của 8 video cũ, cập nhật đường dẫn, thời lượng, tỷ lệ theo video thật, thêm `levels`. Thêm 2 video và 2 bài về Nha Trang.
- `seed-content.ts`: ghi thêm bảng `renditions`, vì `getPlayback` bỏ qua video không có mức nào.
- `seed-content.spec.ts`: đổi số bài, số video mong đợi từ 8 lên 10, thêm test video seed đủ thông tin để phát.

## Kết quả kiểm tra
Chạy đủ các bước của CI, tất cả thoát mã 0: lint, typecheck, test (core-api 320/320), test:int (core-api 53/53), build, `contracts:build` (không đổi contracts).

Thử thật trên máy: nạp seed vào Postgres local, đi hết `GET /v1/feed` với `limit=3`: 10 bài, 4 trang, không trùng. Cả 10 video đọc được qua CloudFront, có 360p, 540p và đủ 3 ảnh bìa. Giải mã hết một video không lỗi. Chạy seed lần 2 không tạo trùng.

## Chưa làm, giới hạn
- Chỉ chạy riêng `seedContent`, chưa chạy toàn bộ `pnpm db:seed` vì máy thiếu `SEED_PASSWORD`.
- Video gốc rộng 576 pixel nên không có mức 720p; worker không phóng to.
- Link trỏ vào CloudFront dev. Môi trường dùng CDN khác thì `hlsUrl` không phát được.
- Tác giả trong seed chưa có trong `access.users`.
- Một số video có logo hoặc watermark của bên khác, chỉ dùng để thử và demo nội bộ.
- Chưa thử phát trên điện thoại.

## Cách kiểm lại
1. `pnpm install && pnpm build`.
2. `pnpm --filter @tripflix/core-api test`.
3. Đặt `SEED_PASSWORD`, chạy `pnpm db:seed`, gọi `GET /api/v1/feed`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `posts-seed.json`, `seed-content.ts`, `seed-content.spec.ts` của Thành. Bài và bình luận cũ không đổi.
