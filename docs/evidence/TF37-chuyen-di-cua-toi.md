# TF37 — Chuyến đi của tôi

- Notion: TF37 (Feature PRD F6 · Mã YC A5) · Nhánh: `thang/TF37-chuyen-di-cua-toi` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- Thêm `GET /api/checkout`: liệt kê mọi đơn của người đang đăng nhập, mới đặt trước. Web và hai điện thoại cùng gọi một API đọc thẳng `commerce.orders`, nên đặt trên web xong mở app là thấy, không qua cache hay đồng bộ.
  - `?status=paid,expired,...` lọc trạng thái (bỏ trống: mọi trạng thái, kể cả `expired` do job TF30 và `cancelled`).
  - Phân trang bằng `cursor` (từ `nextCursor`) và `limit` (1–50, mặc định 20). Con trỏ là (created_at, id); so theo mili giây (`date_trunc`) vì Postgres giữ micro giây còn `Date` của JS thì không, nếu so thẳng sẽ sót đơn ở ranh giới trang.
  - Mỗi chuyến có trạng thái, tổng tiền, mã xác nhận, lúc đặt, lúc trả, `startDate`/`endDate` và các mục (cùng dạng mục của `GET /api/checkout/:id`).
  - Mục của cả trang lấy bằng một câu truy vấn (`findItemsOfOrders`), không N+1. Dùng index sẵn có `idx_orders_user_id (user_id, created_at)`; không có migration.
- `GET /api/checkout` và `GET /api/checkout/:id` trả `Cache-Control: no-store` (dữ liệu riêng từng người, sau này có CDN cũng không bị giữ lại; theo góp ý của Dũng).
- Sự kiện `commerce.order.paid` thêm `confirmationCode`, `contactName`, `contactEmail` (optional, cho phép null) để notification gửi email xác nhận đơn. `contactEmail` null khi khách không nhập email; khi đó notification tra email tài khoản theo `userId`. Chỉ thêm trường; sự kiện cũ trong stream vẫn hợp lệ. Sửa `libs/contracts/src/index.ts` (Dũng) và sinh lại `contracts/events/commerce.order.paid.v1.schema.json`.
- Bài đã lưu (`GET /v1/me/bookmarks`) và bài đã đăng (`GET /v1/me/posts`) đã có sẵn ở `content/social` (Thành); TF37 không sửa phần đó. Màn hình gộp ba mục là việc của web (Thành) và app (Trang).
- Chỉ thêm, không đổi API cũ. Đã chạy `pnpm contracts:build` (`contracts/openapi/core-api.json` +124 dòng, không xoá dòng nào).

File: `booking/api/checkout.controller.ts`, `booking/api/checkout.dto.ts`, `booking/application/checkout.use-cases.ts`, `booking/application/ports.ts`, `booking/infra/drizzle-order.store.ts`, `checkout.int.spec.ts`, `contracts/openapi/core-api.json`.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Đặt trên web xong mở app thấy ngay chuyến đó | Đạt (phía backend) | `checkout.int.spec.ts` › TF37 › "đặt trên web xong, app (phiên khác) thấy ngay chuyến đó; trả tiền xong thấy paid": giữ chỗ bằng một phiên, gọi `GET /api/checkout` bằng phiên khác của cùng tài khoản thấy đơn ngay, trả tiền xong thấy `paid` |
| Hai điện thoại và web thấy cùng dữ liệu | Đạt (phía backend) | Cùng test trên: mọi thiết bị đọc cùng một nguồn; không có cache |
| Chỉ thấy chuyến của mình | Đạt | Test "không thấy đơn của người khác" |

Giao diện web/app chưa làm trong task này nên chưa có ảnh.

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task thành công; unit 45 file, 323 test pass; lint 0 lỗi (61 cảnh báo có sẵn, không có cảnh báo nào ở file TF37).
- `pnpm --filter @tripflix/core-api test:int` (Postgres thật qua Testcontainers): 9 file, 76 test pass.
- `checkout.int.spec.ts` sau khi thêm 5 test TF37: 20/20 pass.
- Sau khi thêm `no-store` và trường liên hệ cho sự kiện: test tích hợp commerce 44/44, `@tripflix/contracts` 4/4, core-api unit 323/323 pass.
- `node tools/check-boundaries.mjs`: không vi phạm ranh giới module.
- `pnpm contracts:build`: `contracts/openapi/core-api.json` +124 dòng, 0 dòng xoá.
- Thử làm hỏng code để kiểm test: 12 kiểu (bỏ lọc người dùng, bỏ so theo mili giây, con trỏ `lt`→`lte`, sắp tăng dần, bỏ lọc trạng thái, không lấy dư 1 đơn, con trỏ lấy đơn đầu trang, `endDate` sai, con trỏ rác không báo lỗi, bỏ giới hạn `limit`, gắn mục sai đơn, `paidAt` luôn null). Lần đầu 11/12 bị bắt; kiểu "gắn mục sai đơn" lọt nên đã thêm kiểm tra mục theo từng đơn, chạy lại thì bị bắt: 12/12.

## Cách kiểm lại
1. `npx --yes pnpm@10.32.1 install`
2. `npx --yes pnpm@10.32.1 turbo run lint typecheck test --filter=@tripflix/core-api`
3. `npx --yes pnpm@10.32.1 --filter @tripflix/core-api test:int` (cần Docker), xem nhóm "TF37 chuyến đi của tôi".
4. Gọi thử: `GET /api/checkout?status=paid&limit=20` với token thành viên; trang sau gửi `cursor=<nextCursor>`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- `contracts/openapi/core-api.json` (CODEOWNERS: Dũng): sinh lại bằng lệnh, chỉ thêm endpoint và schema mới.
- `libs/contracts/src/index.ts` và `contracts/events/commerce.order.paid.v1.schema.json` (Dũng): chỉ thêm 3 trường optional cho `commerce.order.paid`, theo yêu cầu của Dũng cho email xác nhận.
- Gateway (Dũng): cần cho `GET /api/checkout` (không có `:id`) đi qua nếu gateway lọc theo từng đường dẫn.
- Web (Thành) và app (Trang): có endpoint mới để làm màn "Chuyến đi của tôi".
