# TF109 — Ảnh đại diện người dùng (tự tải lên + ảnh Google)

- Jira: chưa tạo · Nhánh: `dung/TF109-anh-dai-dien` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-18
- FE: PR cùng tên ở `tripflix-fe`.

## Đã làm
- Cột `access.users.avatar_url`, `avatar_source` (`upload` | `google` | `none`, có check), migration `20261118021605_add_user_avatar` (chỉ `ADD COLUMN`).
- `PUT /api/auth/me/avatar { mediaId }`: đặt ảnh từ ảnh đã tải xong qua `POST /api/media/uploads`. Kiểm qua `MediaFacade` (của chính mình, là ảnh, đã xong); sai thì 400. Không sửa code `content/media`.
- `DELETE /api/auth/me/avatar`: xoá ảnh, đặt nguồn `none` để Google không gắn lại.
- `GET /api/v1/users/:id/avatar`: 302 tới ảnh (cache 5 phút), chưa có ảnh hoặc tài khoản khoá thì 404. Web, app chỉ cần id tác giả, không phải thêm link ảnh vào DTO của content.
- Đăng nhập Google lấy claim `picture` (chỉ `https://`) khi nguồn trống hoặc `google`; ghi lại mỗi lần đăng nhập vì link Google đổi khi họ đổi ảnh. Không copy ảnh Google về S3.
- `GET/PATCH /api/auth/me` trả thêm `avatarUrl`.
- Sự kiện `access.user.registered` và `access.user.profile_updated` thêm `avatarUrl` (optional). notification-service lưu vào `user_directory.avatar_url`; sự kiện cũ không có trường này thì giữ ảnh đang lưu, `null` thì xoá.
- Thông báo "bài mới của người bạn theo dõi" thêm `data.actorIds` (như thông báo bình luận) để web hiện ảnh người đăng.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Tự tải ảnh lên và đổi, xoá được | Có (API) | `google-login.e2e.spec.ts` › TF109 |
| Google tự lấy ảnh khi chưa có ảnh riêng; đã tự tải hay tự xoá thì không ghi đè | Có | như trên |
| Ảnh của người khác, video, chưa xong, mediaId sai dạng: 400; chưa đăng nhập: 401 | Có | như trên; `media-avatar-images.spec.ts` |
| Ảnh hiện ở thông báo | Có (dữ liệu) | `directory.int.spec.ts` › TF109 |
| Chỉ thêm field ở API, sự kiện; đã `pnpm contracts:build` | Có | `contracts/` |

## Kết quả kiểm tra
- core-api `pnpm test`: 2778 test pass, 4 skip. `pnpm typecheck` sạch. `pnpm lint`: 0 lỗi (cảnh báo có sẵn ở file khác).
- notification-service `pnpm test`: 135 pass; typecheck, lint sạch.
- Chưa chạy: `pnpm test:int` (cần Docker) gồm `drizzle-access.store.int.spec.ts` › TF109 và `directory.int.spec.ts` › TF109.

## Cách kiểm lại
1. `pnpm stack:infra`, `pnpm build`, `pnpm db:migrate`, chạy core-api và notification-service.
2. Tải ảnh lên qua `POST /api/media/uploads` (image), rồi `PUT /api/auth/me/avatar` với `assetId`.
3. `GET /api/auth/me` thấy `avatarUrl`; `GET /api/v1/users/<id>/avatar` trả 302.

## Ảnh / video
- Không đổi giao diện ở repo này. Ảnh web nằm ở PR FE.

## Ảnh hưởng tới phần của người khác
- `access`, `notification-service`, `libs/contracts`: của Dũng.
- Đọc `MediaFacade` của `content/media` (Phong) qua `index.ts`, không sửa file nào của Phong.
