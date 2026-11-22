# TF06O — Đăng ký kèm ngày sinh, giới tính, quốc tịch và đồng ý điều khoản

- Notion: TF06O · Nhánh: `dung/TF06O-dang-ky-ho-so` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-09

## Đã làm
- `POST /api/auth/register` nhận thêm `dateOfBirth`, `gender`, `nationality` (bắt buộc) và `acceptTerms: true`. Ngày sinh, giới tính, quốc tịch dùng chung luật kiểm với `PATCH /auth/me` (TF06M): tách thành `dateOfBirthField`, `genderField`, `nationalityField` trong `auth/api/validation.ts`, schema sửa hồ sơ dùng lại các hàm này.
- Bảng `access.users` thêm `terms_version`, `terms_accepted_at` (migration `20261109040546_add_user_terms_acceptance`, chỉ thêm cột cho phép trống). Phiên bản điều khoản do BE ghi (`TERMS_VERSION` trong `auth/domain/registration.ts`), không lấy từ client.
- Thông tin cá nhân ghi cùng transaction tạo tài khoản; không đưa lên event bus (payload `access.user.registered`, `welcome_email_requested` không đổi).
- Tài khoản tạo qua Google chưa có các trường này (trống), như trước.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Đăng ký bắt buộc ngày sinh, giới tính, quốc tịch hợp lệ | Đạt | `validation.spec.ts` (TF06O: 5 test), `validation.e2e.spec.ts` "thiếu ngày sinh, giới tính, quốc tịch" |
| Phải đồng ý điều khoản, lưu phiên bản và thời điểm | Đạt | `validation.e2e.spec.ts` "chưa đồng ý điều khoản", "TF06O: đăng ký lưu ...", `auth.use-cases.int.spec.ts` kiểm cột trong Postgres |
| Không đưa thông tin cá nhân lên event bus | Đạt | `validation.e2e.spec.ts` TF06O |

## Kết quả kiểm tra
- `pnpm vitest run src/modules/access` (core-api): 20 file, 301 test pass.
- `pnpm test:int src/modules/access` (Postgres thật): 3 file, 28 test pass.
- `pnpm turbo run lint typecheck --filter=@tripflix/core-api`: pass; lint 0 lỗi, không có cảnh báo trong module access (81 cảnh báo có sẵn ở `content/social`).
- `pnpm contracts:build`: `contracts/openapi/core-api.json` thêm 4 trường vào `RegisterDto`.

## Cách kiểm lại
1. `pnpm db:migrate`, chạy core-api.
2. Gửi `POST /api/auth/register` thiếu `acceptTerms` hoặc `nationality`: 400 kèm đúng trường. Gửi đủ: 201, `GET /api/auth/me` trả ngày sinh, giới tính, quốc tịch đã nhập.

## Ảnh / video
- Không đổi giao diện ở repo này (giao diện ở tripflix-fe TF06O).

## Ảnh hưởng tới phần của người khác
- Có: app mobile (Trang) gọi `POST /auth/register`; sau PR này phải gửi thêm 4 trường. Đã sửa màn đăng ký mobile trong PR tripflix-fe TF06O, cần merge cùng đợt deploy. Báo Trang trước khi merge.
- `contracts/openapi/core-api.json`: FE chạy lại `pnpm gen:api`.
