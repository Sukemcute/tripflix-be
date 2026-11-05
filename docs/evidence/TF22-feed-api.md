# TF22 — Bản đầu của GET /v1/feed

- Task: TF22 · Nhánh: `phong/TF22-feed-api` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-05

Bản đầu để app phát được video bằng API cuối cùng, không qua API tạm. Chưa có xếp hạng.

## Đã làm
- `GET /api/v1/feed?limit&cursor&tab`: khách xem được, có token thì kèm `viewerState`, token sai thì coi như khách.
- Chỉ trả bài công khai đã đăng có video phát được, mới nhất trước. Lọc ngay trong câu truy vấn nên một trang không bị thiếu bài.
- Bài nhiều media thì lấy video đầu tiên phát được.
- Cursor giữ đủ micro-giây, nên các bài cùng thời điểm không bị rớt hay lặp khi sang trang. Cursor sai trả 400.
- `getPlayback` bỏ video `ready` chưa có dòng `renditions`, vì đó là dữ liệu nạp tay, chưa chắc có file trên CDN.

## Khác với docs/09
- `video.posters` gồm 3 cỡ thay cho một `posterUrl`, để app chọn theo chiều rộng màn hình. Có thêm `levels` và `title`.
- `tab` chỉ nhận `for_you`, tab khác trả 400.
- Chưa có `snapshotId`. Cursor là chuỗi app không cần hiểu, nên đổi cách làm sau không ảnh hưởng app.
- Trả giá trị rỗng: `author.name`, `author.avatarUrl`, `region`, `reason` là `null`; `isKol` là `false`; `linkedProductIds` là `[]`.

## Kết quả kiểm tra
Chạy đủ các bước của CI, tất cả thoát mã 0:
- `pnpm lint`, `pnpm typecheck`: 23/23 task.
- `pnpm test`: 23/23 task; core-api 319/319 test.
- `pnpm test:int`: 16/16 task; core-api 53/53 test trên Postgres thật.
- `pnpm build`: 13/13 task.
- `pnpm contracts:build`: thêm `/api/v1/feed` và các DTO vào OpenAPI.

Thử thật trên máy với Postgres local và CloudFront: tạo, đăng, thích, lưu, xoá bài qua API thật, `GET /v1/feed` trả đúng từng bước; `hlsUrl` và 3 ảnh bìa đều đọc được qua CloudFront.

## Chưa làm, giới hạn
- Chưa thử phát trên điện thoại.
- Dữ liệu seed hiện không có video phát được nên feed của database mới seed là danh sách trống, cho tới khi cập nhật seed.
- Chưa có tên tác giả: `access` chưa có hàm cho module khác đọc, và tác giả trong seed chưa có trong `access.users`.
- Tab `hot`, `following`, xếp hạng, snapshot, lọc bài đã xem thuộc các phần sau của TF22, TF23.

## Cách kiểm lại
1. `pnpm install && pnpm build`.
2. `pnpm --filter @tripflix/core-api test`.
3. `pnpm --filter @tripflix/core-api test:int`, cần Docker.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không sửa code của người khác. Feed đọc bảng `posts`, `reactions`, `bookmarks` của Thành theo luật cùng schema ở docs/09 mục 1, và dùng lại `OptionalAuthGuard` của Thành.
