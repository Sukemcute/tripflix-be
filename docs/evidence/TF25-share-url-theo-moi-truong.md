# TF25 — Link chia sẻ bài trỏ về web theo môi trường

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-share-url-theo-moi-truong` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-13

## Bối cảnh
`shareUrl` (chi tiết bài, đăng bài, ghi nhận chia sẻ, và trong sự kiện `content.post.published` / `content.post.shared`) ghi cứng `https://tripflix.vn/posts/<id>`: tên miền chưa phải web của team và web không có trang `/posts/...`, nên link chia sẻ từ Reels là link chết. Ghi cứng URL môi trường cũng trái RULES §4.

## Đã làm
- **Biến môi trường** `WEB_APP_URL` cho core-api (mặc định `http://localhost:3100`, cùng tên với notification-service), thêm vào `.env.example`.
- **`PostShareLinks`** (`social/application/post-share-links.ts`): link về trang Cảm hứng mở sẵn bài, `<WEB_APP_URL>/inspiration?open=<id>`; Reel (`video`) thêm `&kind=reel` để web mở trong trình xem Reels. Cùng dạng với link web tự tạo.
- `GetPostDetailUseCase`, `PublishPostUseCase`, `TrackShareUseCase` dùng `PostShareLinks` (tham số cuối của constructor, mặc định là web dev); `content.module.ts` tạo một provider từ `CORE_ENV`.
- Không đổi hợp đồng API hay sự kiện: `shareUrl` vẫn là chuỗi, chỉ đổi giá trị. Không cần `contracts:build`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Link chia sẻ trỏ về web theo môi trường, không ghi cứng | Có | `post-share-links.spec.ts` › bài viết mở trang Cảm hứng theo địa chỉ web của môi trường; bỏ `/` cuối; không cấu hình thì dùng web dev |
| Reel mở được trong trình xem Reels | Có | `post-share-links.spec.ts` › Reel thêm kind=reel |
| Đăng bài và ghi nhận chia sẻ trả link mới | Có | `social-use-cases.spec.ts` › PublishPostUseCase xuất bản thành công…; ghi nhận lượt chia sẻ tăng shareCount… |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task; core-api 2338 test pass (1 skipped có sẵn); lint 0 lỗi, không có warning mới ở file đã sửa.

## Cách kiểm lại
1. Đặt `WEB_APP_URL` trong env của core-api (vd. `https://tripflix.io.vn`), khởi động lại.
2. `GET /v1/posts/<id>` trả `shareUrl` = `https://tripflix.io.vn/inspiration?open=<id>` (Reel thêm `&kind=reel`); mở link trên web ra đúng bài.

## Ảnh / video
- Không có (không đổi giao diện).

## Ảnh hưởng tới phần của người khác
- `platform/env.ts` (cấu hình chung của core-api): thêm một biến có mặc định, không đổi biến cũ.
- `deploy/` (anh Phong): staging cần đặt `WEB_APP_URL` cho core-api (`.env.server` / `compose.server.yaml`); chưa đặt thì link trỏ về `http://localhost:3100`. Đã nhắn anh Phong.
- Sự kiện `content.post.published`, `content.post.shared`: `shareUrl` đổi giá trị (vẫn là chuỗi); notification-service, video-worker, libs và tripflix-ai hiện không đọc trường này (đã tìm theo tên).
