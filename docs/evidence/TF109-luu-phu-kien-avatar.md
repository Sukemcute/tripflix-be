# TF109 — Lưu khung và phụ kiện ảnh đại diện lên server

- Notion: — · Nhánh: `dung/TF109-luu-phu-kien-avatar` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-19

## Đã làm
- Bảng `access.users` thêm cột `avatar_decor` (jsonb, trống được), migration `20261119021710_add_user_avatar_decor`.
- `PUT /api/auth/me/avatar-decor` lưu `{ frameId, stickers[] }`, `DELETE` gỡ hết. Kiểm định dạng: mã khung, sticker `^[a-z0-9-]{1,40}$`, tối đa 12 sticker, toạ độ -1..2, cỡ 0.5..2.4, xoay ±3600, không nhận trường lạ.
- `GET /api/v1/users/:id/avatar-decor` công khai, cache 5 phút; tài khoản bị khoá hay chưa trang trí trả `avatarDecor: null`.
- `MyProfileDto` (`/auth/me`) có thêm `avatarDecor`.
- Không ghi sự kiện, nhật ký: chỉ là trang trí, chưa dịch vụ nào khác cần.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Lưu phụ kiện, người khác đọc được | Có | `google-login.e2e.spec.ts` › khung và phụ kiện: lưu rồi người khác đọc được |
| Dữ liệu sai bị chặn | Có | cùng test: 13 sticker, mã lạ, toạ độ, cỡ sai, trường lạ → 400; chưa đăng nhập → 401 |
| Lưu vào DB thật | Viết test, chưa chạy | `drizzle-access.store.int.spec.ts` › TF109: khung và phụ kiện avatar (máy chưa bật Docker) |

## Kết quả kiểm tra
- `vitest run src/modules/access`: 30 file, 383 test pass.
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: xem PR.
- `pnpm contracts:build`: đã sinh lại `contracts/openapi/core-api.json`.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api test:int` (cần Docker).
2. Đăng nhập, `PUT /api/auth/me/avatar-decor` với `{ "frameId": "fox-hat", "stickers": [] }`, rồi `GET /api/v1/users/<id>/avatar-decor`.

## Ảnh / video
- Không đổi giao diện (BE). Ảnh ở PR FE dùng API này.

## Ảnh hưởng tới phần của người khác
- Không: chỉ module `access` (Dũng).
