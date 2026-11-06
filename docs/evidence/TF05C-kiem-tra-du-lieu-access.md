# TF05C — access: kiểm dữ liệu đầu vào đầy đủ cho mọi trường

- Notion: <dán link task TF05C> · Nhánh: `dung/TF05C-kiem-tra-du-lieu-access` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-06
- Chỉ module `access` của core-api. Không đổi DB, không đổi `contracts/openapi/core-api.json` (đã sinh lại, không khác).

## Vấn đề

Mỗi endpoint của access chỉ có 1–2 test cho dữ liệu sai. Chạy thử khoảng 80 đầu vào biên thì thấy:

| #   | Chỗ sai                                                                          | Ví dụ                                               |
| --- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | Email có khoảng trắng hai đầu bị từ chối khi đăng ký                             | `" a@x.com "` → 400 "Email không hợp lệ"            |
| 2   | Mật khẩu chỉ có khoảng trắng vẫn được nhận                                       | 8 dấu cách → tạo được tài khoản                     |
| 3   | Tên hiển thị nhận xuống dòng, ký tự điều khiển, ký tự vô hình                    | `"a\nb"`, `"​"` (nhìn như trống)                    |
| 4   | Quốc tịch nhận mã không có thật                                                  | `"XX"`, `"EU"`                                      |
| 5   | Nhiều câu lỗi là tiếng Anh mặc định của zod                                      | "Too big: expected string to have <=128 characters" |
| 6   | Tên thiết bị trống lưu `""` thay vì `null`; ngày `2023-02-29` báo 2 lỗi cùng lúc |                                                     |

## Đã làm

- **Câu lỗi tiếng Việt** (`auth/api/validation.ts`): `accessErrorMap` thay câu mặc định của zod (thiếu trường, sai kiểu, quá ngắn, quá dài, sai định dạng, không phải object), truyền khi parse trong `ZodBody` nên chỉ áp dụng cho access, không đổi cấu hình zod của module khác. Câu viết riêng trong schema vẫn được ưu tiên. Dạng lỗi giữ nguyên `400 { message, errors: [{ field, message }] }`.
- **Trường dùng chung** cho mọi schema của access:
  - Email đăng ký: cắt khoảng trắng rồi mới kiểm định dạng (sửa #1). Email đăng nhập, quên mật khẩu: cắt khoảng trắng, vẫn không kiểm định dạng để không lộ email nào đã đăng ký.
  - Mật khẩu mới (đăng ký, đổi, đặt lại): 8–128 ký tự, phải có ký tự không phải khoảng trắng (kể cả dấu cách không ngắt, zero-width) (sửa #2). Mật khẩu hiện tại không đổi quy tắc, để tài khoản cũ vẫn đăng nhập được.
  - Tên hiển thị (đăng ký, sửa hồ sơ): chuẩn hoá NFC, cắt khoảng trắng, 1–50 ký tự, một dòng, có ít nhất một ký tự nhìn thấy (sửa #3). Tên lấy từ Google được làm sạch theo cùng quy tắc, cắt 50 ký tự không cắt đôi emoji.
  - Tên thiết bị (đăng nhập, Google): ký tự điều khiển đổi thành dấu cách, trống thì `null` (sửa #6).
- **Quốc tịch**: danh sách 249 mã ISO 3166-1 alpha-2 (`account/domain/countries.ts`) (sửa #4). Test đối chiếu từng mã với dữ liệu CLDR của Node.
- **Mỗi trường sai một lỗi**: kiểm tra tuổi, khoảng trắng, ký tự điều khiển chỉ chạy khi các kiểm tra trước của trường đã qua (sửa #6).
- Câu lỗi riêng cho refresh token, ID token Google, mã đặt lại mật khẩu, tìm người dùng (`page`, `query`) (sửa #5).
- README access: mục "Kiểm dữ liệu đầu vào (TF05C)" ghi đủ quy tắc từng trường.

## Test thêm

| File                                          | Số test | Nội dung                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/api/validation.spec.ts` (mới)           | 150     | Từng schema (đăng ký, đăng nhập, refresh, Google, sửa hồ sơ, đổi/quên/đặt lại mật khẩu, tìm người dùng, cấp quyền, service token), từng trường: đúng, biên min/max và ±1, sai kiểu, thiếu, null, chuẩn hoá, trường lạ bị bỏ, nhiều trường sai cùng lúc, không còn câu tiếng Anh                                              |
| `auth/domain/text-rules.spec.ts` (mới)        | 6       | Ký tự nhìn thấy / vô hình / điều khiển, `normalizeEmail`, `buildDisplayName`                                                                                                                                                                                                                                                 |
| `account/domain/countries.spec.ts` (mới)      | 3       | 249 mã, khớp check DB, có tên thật trong CLDR, từ chối XX/ZZ/EU/UN/XK                                                                                                                                                                                                                                                        |
| `account/domain/personal-info.spec.ts`        | +4 (7)  | Đúng ngày sinh nhật, sinh 29/02 (năm nhuận và không nhuận), giờ trong ngày, biên 120 tuổi, ngày sinh tương lai                                                                                                                                                                                                               |
| `validation.e2e.spec.ts` (mới)                | 31      | Qua HTTP: JSON hỏng 400, không có body, body là mảng, dạng lỗi chỉ có `message` + `errors`, chèn `role`/`status`/`email` không có tác dụng, dữ liệu cũ giữ nguyên khi 400, email chữ hoa + khoảng trắng đăng nhập được, tên thiết bị lưu `null`, 400 có `errors` khác với 401 sai mật khẩu, admin `page` và id trong URL sai |
| `auth/infra/drizzle-access.store.int.spec.ts` | +1      | Postgres thật: từng check của `users` (role, status, email chữ thường, gender, nationality, phone, ngày không có thật, email trùng) chặn đúng tên ràng buộc khi ghi thẳng SQL                                                                                                                                                |

## Đối chiếu "Xong khi"

| Tiêu chí                                                             | Đạt | Bằng chứng                                                                                          |
| -------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------- |
| Mọi trường đầu vào của access có test cho trường hợp đúng, biên, sai | Có  | `validation.spec.ts` 150 test                                                                       |
| Lỗi tìm được được sửa, có test tái hiện                              | Có  | #1–#6: test trong `validation.spec.ts`, `validation.e2e.spec.ts`                                    |
| Qua HTTP trả đúng 400 và đúng trường, không ghi dữ liệu              | Có  | `validation.e2e.spec.ts` 31 test                                                                    |
| DB chặn dữ liệu sai dù bỏ qua API                                    | Có  | `drizzle-access.store.int.spec.ts` (TF05C)                                                          |
| Không đổi API cho FE                                                 | Có  | contracts sinh lại không khác; FE (`getAuthErrorKind`) chỉ dựa vào mã HTTP và có `errors` hay không |

## Kết quả kiểm tra

Chạy ngày 2026-11-06:

```
pnpm turbo run lint typecheck test --affected → 49/49 task pass; core-api 600 pass, 1 skip (có sẵn)
node tools/check-boundaries.mjs → "Ranh giới module: không có vi phạm."
npx vitest run --config vitest.int.config.ts src/modules/access → 3 file, 21 test pass (Postgres, Redis thật qua Testcontainers)
pnpm contracts:build → contracts/openapi/core-api.json không đổi
```

## Ảnh hưởng tới người dùng và FE

- Tài khoản đã có mật khẩu toàn khoảng trắng vẫn đăng nhập được; chỉ không đặt mật khẩu mới kiểu đó.
- Câu lỗi trong `errors[].message` đổi từ tiếng Anh sang tiếng Việt; tên trường, mã HTTP, dạng body không đổi.
- Quốc tịch đã lưu dạng mã không có thật (nếu có) vẫn đọc được; chỉ không lưu mới được.

## Ảnh hưởng tới phần của người khác

- Không. Chỉ sửa `apps/core-api/src/modules/access` (của Dũng).
