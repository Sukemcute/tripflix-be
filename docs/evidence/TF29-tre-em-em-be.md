# TF29 — Vé máy bay cho trẻ em và em bé (BE)

- Notion: [TF29](https://app.notion.com/p/40dcb9b9e5c281c888e4f3e134183ae6) · Nhánh: `trang/TF29-tre-em-em-be` · Người làm: Lê Thị Thùy Trang (dùng AI: có) · Ngày: 2026-11-08

## Đã làm
- Luật nhóm khách (`sales-rules.ts`):
  - Ít nhất 1 người lớn; người lớn + trẻ em tối đa 9 ghế.
  - Em bé không quá số người lớn.
  - Trẻ em 2–11 tuổi chiếm ghế, giá **75%** giá người lớn. Em bé dưới 2 tuổi ngồi cùng người lớn, không chiếm ghế, giá **10%**. Cả hai làm tròn tới 10.000đ như giá người lớn.
- `GET /flights`, `/flights/calendar`, `/flights/:id` nhận thêm `children`, `infants` (tuỳ chọn, mặc định 0).
  - Mỗi gói vé trả thêm `childPrice`, `infantPrice`.
  - `totalPrice` là tổng cả nhóm.
  - Kiểm còn ghế theo số ghế người lớn + trẻ em.
- `POST /checkout` nhận thêm `children`, `infants`.
  - Vé bay giữ `adults + children` ghế (`qty`).
  - Đơn lưu số trẻ em, em bé qua migration `20261108064122_add_order_passenger_types`: 2 cột mặc định 0 và ràng buộc kiểm tra. Đơn cũ không bị ảnh hưởng.
  - Dòng vé bay: `unitPrice` là giá một vé người lớn, kèm `childUnitPrice`, `infantUnitPrice` (cột mới của `order_items`, phòng là null). `lineTotal` là cả nhóm, không phải `unitPrice × qty`. Thanh toán tính lại giá thì cập nhật cả ba đơn giá.
  - Giỏ chỉ có phòng mà gửi `children`/`infants` > 0 thì trả 400, vì phòng chỉ tính theo người lớn.
- Hành khách phải nhập gồm cả 3 loại.
  - `CheckoutDto` trả thêm `children`, `infants`, `passengerTypes` (loại của từng hành khách theo thứ tự); `TripDto` trả thêm `children`, `infants`.
  - `PUT /checkout/:id/guests` kiểm tuổi theo chặng: người lớn từ 12 tuổi ở chặng đầu; trẻ em tối đa 11 tuổi ở chặng đầu và đủ 2 tuổi ở chặng cuối; em bé dưới 2 tuổi tới chặng cuối (bé lên 2 tuổi giữa chuyến khứ hồi phải đi vé trẻ em có ghế).
  - Loại khách lưu cùng từng hành khách (cột `order_guests.passenger_type`), không phải suy ra từ thứ tự.
- Thanh toán tính lại giá theo đủ 3 loại khách.
- Mọi thay đổi API chỉ thêm trường; đã chạy `pnpm contracts:build`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Chọn được người lớn, trẻ em, em bé khi tìm và đặt vé | Có | `flight-search.use-cases.spec.ts`: "trẻ em chiếm ghế, em bé không…"; `checkout.int.spec.ts`: "vé bay có trẻ em, em bé…" |
| Giá trẻ em 75%, em bé 10% | Có | `sales-rules.spec.ts`: 2 người lớn + 1 trẻ em + 1 em bé = 4.280.000 với giá 1.500.000; API thật trên stack local: 2.530.000 / 1.900.000 / 250.000, tổng 7.210.000 |
| Em bé không chiếm ghế, mỗi em bé một người lớn, tối đa 9 ghế | Có | `findPassengerMixError` test; integration: giữ đúng 3 ghế cho 2 người lớn + 1 trẻ em + 1 em bé; `infants > adults` trả 400 trường `infants` |
| Ngày sinh đúng loại khách theo chặng | Có | `order-rules.spec.ts` (gồm lên 2 tuổi giữa chuyến khứ hồi, sinh 29/02); integration: em bé 3 tuổi trả 400 `guests[3].birthdate` |
| Đơn giá dòng vé bay đúng từng loại khách, loại khách lưu cùng hành khách | Có | integration: `unitPrice`/`childUnitPrice`/`infantUnitPrice` khớp giá gói, `order_guests.passenger_type` = adult, adult, child, infant |
| Giỏ chỉ có phòng không nhận trẻ em, em bé | Có | integration: 400 trường `children` |
| Đơn cũ, vé chỉ có người lớn, khách sạn không đổi | Có | Toàn bộ test commerce cũ vẫn pass; migration chỉ thêm cột mặc định 0 |

## Kết quả kiểm tra
- `vitest run src/modules/commerce`: 9 file, 61 test pass (thêm `order-rules.spec.ts` và test mới trong `sales-rules.spec.ts`, `flight-search.use-cases.spec.ts`).
- `vitest --config vitest.int.config.ts` checkout + expire-holds (Testcontainers Postgres): 40/40 pass, gồm test tích hợp mới.
- `pnpm test` toàn core-api: 643 pass, 1 skip. 2 test `access` (auth/staff e2e) bị quá 5 giây khi chạy cùng cả bộ; chạy riêng pass 12/12, không liên quan thay đổi này.
- `pnpm lint` (core-api): exit 0, không có cảnh báo ở commerce. `typecheck` pass. `node tools/check-boundaries.mjs`: không vi phạm.
- Chạy thật: build lại `core-api` và `migrate` trên stack local, web nhánh FE tương ứng đặt được đơn 2 người lớn + 1 trẻ em + 1 em bé, đơn giữ 3 ghế, tổng 7.210.000.

## Cách kiểm lại
1. `pnpm db:migrate` (hoặc `pnpm stack:be`).
2. `GET /api/flights?from=SGN&to=HAN&date=<ngày>&passengers=2&children=1&infants=1`: mỗi gói có `childPrice`, `infantPrice`, `totalPrice` = 2 × người lớn + trẻ em + em bé.
3. `POST /api/checkout` với `{ adults: 2, children: 1, infants: 1, items: [{ productId, checkIn }] }`: `items[0].qty = 3`, `passengerTypes = [adult, adult, child, infant]`.

## Ảnh / video
- Ảnh giao diện web đính kèm ở PR FE.

## Ảnh hưởng tới phần của người khác
- Có: module `commerce` (Thắng, backup Bảo). Thắng đã review vòng 1; 5 góp ý đã sửa (đơn giá vé bay, tuổi theo chặng, lưu loại khách, chặn trẻ em/em bé ở giỏ chỉ có phòng, phần vặt). Gồm thêm trường API, migration mới cho `commerce.orders`, `order_items`, `order_guests`, đổi tham số `CheckoutUseCases.priceItems` từ số người lớn sang nhóm khách (chỉ dùng trong commerce: checkout và payment). Cần Thắng review trước khi merge.
