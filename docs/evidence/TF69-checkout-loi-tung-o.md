# TF69 — Checkout báo lỗi đúng từng ô thông tin khách (BE trả danh sách trường sai)

- Jira: [SCRUM-73](https://tripflix.atlassian.net/browse/SCRUM-73) · Nhánh: `trang/TF69-checkout-loi-tung-o` · Người làm: Lê Thị Thùy Trang (dùng AI: có) · Ngày: 2026-11-08

## Đã làm
- `booking/domain/order-rules.ts`: thêm `listGuestFieldErrors` trả từng trường sai kèm câu cụ thể (thiếu tên, số điện thoại sai, email sai, ngày sinh trống / sau hôm nay / sai tuổi theo loại khách). `findInvalidGuestFields` giữ nguyên chữ ký, giờ lấy tên trường từ hàm mới.
- `checkout.use-cases.ts` (`setGuests`): lỗi `invalid_query` kèm `details.errors` (mọi trường sai) và `fields`.
- `inventory/api/http.ts` (`CommerceErrorFilter`): lỗi 400 trải thêm `err.details` vào body, giống các nhánh 409/402. Trước đây nhánh 400 bỏ mất `details` nên client chỉ nhận một trường đầu và câu chung "Thông tin khách chưa đủ hoặc chưa đúng".
- Body lỗi 400 của `PUT /api/checkout/:id/guests` giờ là `{ message, errors: [{ field, message }], fields, passengersRequired }`. Chỉ thêm trường, client cũ vẫn đọc được `message` và `errors`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Người lớn ngày sinh dưới 12 tuổi: báo "phải đủ 12 tuổi vào ngày bay" đúng hành khách | Đạt | `order-rules.spec.ts` › "người lớn sinh hôm nay: báo đúng ô ngày sinh…" |
| Thiếu tên, số điện thoại sai, email sai: báo đúng ô | Đạt | `order-rules.spec.ts` › "trả đủ mọi trường sai, mỗi trường một câu riêng" |
| Lỗi 400 có `errors[]` đủ các trường sai kèm câu cụ thể | Đạt | `checkout.int.spec.ts` kiểm body lỗi 400 có `errors` (field + câu cụ thể) và `fields` |
| Test pass | Đạt | xem bên dưới |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task pass; core-api 59 file test pass, 650 test pass, 1 skip có sẵn.
- `vitest run --config vitest.int.config.ts src/modules/commerce` (Postgres, Redis thật qua Testcontainers): 3 file, 47 test pass; riêng `checkout.int.spec.ts` 22 test pass.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/commerce/booking/domain/order-rules.spec.ts`
2. Có Docker: `pnpm --filter @tripflix/core-api test:int` (ca "đặt vé bay theo loại khách…" kiểm body lỗi 400).
3. Gọi tay: giữ chỗ một vé bay 1 người lớn rồi `PUT /api/checkout/:id/guests` với ngày sinh hôm nay, body trả `errors: [{ field: 'guests[0].birthdate', message: 'Hành khách 1 là người lớn, phải đủ 12 tuổi vào ngày bay.' }]`.

## Ảnh / video
- Ảnh màn checkout ở PR web cùng task (tripflix-fe, nhánh `trang/TF69-checkout-loi-tung-o`).

## Ảnh hưởng tới phần của người khác
- Có: module `commerce` của Thắng (`booking/domain/order-rules.ts`, `booking/application/checkout.use-cases.ts`, `inventory/api/http.ts`). Người dùng đã đồng ý sửa trong phiên. Không đổi chữ ký hàm có sẵn, không đổi schema; body lỗi 400 chỉ thêm trường. Các lỗi `invalid_query` khác không có `details` nên body không đổi.
