# TF06M — access: thông tin cá nhân trong hồ sơ (`GET/PATCH /auth/me`)

- Notion: <dán link task TF06M> · Nhánh: `dung/TF06M-ho-so-ca-nhan` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-06
- Phần BE cho trang tài khoản dạng hồ sơ ở `tripflix-fe` (PR FE làm sau khi PR này merge).

## Đã làm
- **Migration** `access/20261106020543_add_user_personal_info`: thêm vào `access.users` các cột `phone`, `date_of_birth` (`date`), `gender`, `nationality`, đều cho phép trống, kèm check `ck_users_gender` (`male`, `female`, `other`), `ck_users_nationality` (`^[A-Z]{2}$`), `ck_users_phone` (`^[+]?[0-9]{8,15}$`). Chỉ thêm cột, không đổi dữ liệu cũ.
- **`GET /auth/me`, `PATCH /auth/me`** trả `MyProfileDto` (thông tin người dùng + 4 trường trên). `PATCH` nhận thêm 4 trường, mọi trường đều tuỳ chọn (cần ít nhất một), `null` hoặc `""` để xoá (trừ tên). Kiểm tra bằng zod: số điện thoại bỏ dấu cách, chấm, gạch, ngoặc rồi phải có 8–15 chữ số (có thể `+` ở đầu); ngày sinh `YYYY-MM-DD`, tuổi 13–120; giới tính trong danh sách; quốc tịch 2 chữ cái, tự viết hoa. Sai: `400 { errors: [{ field, message }] }`.
- **Chỉ ghi trường thật sự đổi.** Audit `auth.profile_updated` ghi `meta.changedFields`, không ghi giá trị thông tin cá nhân. `access.user.profile_updated` v1 giữ nguyên `{ userId, displayName }`, chỉ phát khi tên đổi: thông tin cá nhân không lên event bus.
- **Không lộ ra chỗ khác**: `PublicUser` (đăng ký, danh sách nhân viên, tìm người dùng của admin) không có thông tin cá nhân; kiểu riêng `MyProfile` chỉ dùng cho `/auth/me`.
- Store: `updateDisplayName` → `updateProfile(id, patch)` (Drizzle + in-memory). `contracts/openapi/core-api.json` sinh lại (chỉ đổi phần `/auth/me`). README access có mục "Thông tin cá nhân".

## Kết quả kiểm tra
Chạy ngày 2026-11-06, Node 24.22.1, pnpm 10.32.1:

```
pnpm turbo run lint typecheck test → 49/49 task; core-api 406 pass (1 skip); access 0 cảnh báo lint
  (81 cảnh báo có sẵn trên develop đều ở module content)
pnpm test:int → 16/16 task; core-api 79 pass (Postgres thật, gồm ca TF06M: lưu, xoá, DB chặn giá trị sai)
pnpm contracts:build → đã ghi contracts/openapi/core-api.json
```

Test mới: `account.e2e.spec.ts` (đọc/sửa/xoá, chuẩn hoá, không phát sự kiện khi chỉ đổi thông tin cá nhân, audit không chứa giá trị; 7 ca sai định dạng trả 400 đúng trường; body rỗng 400), `staff.e2e.spec.ts` (admin tìm người dùng, danh sách nhân viên không có thông tin cá nhân), `personal-info.spec.ts` (tính tuổi, chuẩn hoá số điện thoại), `drizzle-access.store.int.spec.ts`.

Gọi thật qua gateway `:8080` với `member@tripflix.local`: `PATCH` hợp lệ → 200, `phone: "0912345678"`, `nationality: "VN"`; `{ phone: "abc", dateOfBirth: "2030-01-01" }` → 400 với 2 lỗi `phone`, `dateOfBirth`; gửi `null` → 200, các trường về `null`.

## Ghi chú
- Trên máy dev, `pnpm db:migrate` dừng ở `commerce` vì migration `20261105102339_add_hotel_details` (TF10) đã bị xoá và gộp vào `20261105182815` — không liên quan PR này; `access` migrate xong trước đó.

## Ảnh hưởng tới phần của người khác
- Không: chỉ module `access` (chủ: Dũng) và `contracts/openapi/core-api.json` sinh tự động. FE (Thành) cần sinh lại api-client để dùng trường mới.
