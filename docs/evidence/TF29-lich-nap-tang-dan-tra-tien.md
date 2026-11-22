# TF29 — Lịch bộ nhớ chỉ nạp ô đổi, trả tiền bớt lượt gọi database

- Notion: <dán link task TF29> · Nhánh: `thang/TF29-lich-nap-tang-dan-tra-tien` · Người làm: Thắng Nguyễn Lê Phúc (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- **L1, lịch trong bộ nhớ chỉ nạp ô đổi.**
  - Trước đây `CalendarSnapshot` nạp lại cả lịch (~950 nghìn dòng, có join `room_rates`) mỗi 10 giây, nên Postgres tốn khoảng 370% CPU dù không có khách.
  - Migration `20261116050241_inventory_changed_at` thêm cột `changed_at`, index và trigger `clock_timestamp()` cho `room_inventory`, `room_rates`, `flight_inventory`. Trigger nên mọi đường ghi đều được tính, kể cả SQL tay.
  - Migration chạy `ANALYZE` ở cuối. Thiếu bước này, cột mới chưa có thống kê nên câu nạp phần đổi bị chọn cách quét cả bảng (338 ms thay vì 0,05 ms).
  - Snapshot mỗi 10 giây chỉ đọc các ô có `changed_at` mới hơn lượt trước, đọc chồng 60 giây để không sót transaction commit muộn. Mốc thời gian lấy theo giờ database. Cứ 15 phút nạp lại cả lịch.
- **Trả tiền bớt lượt gọi database (37 → 26 câu).** Khi Node quá tải, mỗi câu nối tiếp phải xếp hàng nên trả tiền timeout trước các bước khác.
  - Dựng response từ dữ liệu TX2 vừa ghi (`getCheckout` có thêm tuỳ chọn `known`), không đọc lại.
  - Gộp 2 lần `updateOrder` trong TX1 thành một câu.
  - Đơn chỉ có phòng thì không đọc bảng chuyến bay.
  - Cổng giả lập dùng `insert … on conflict do nothing returning`, bỏ lần đọc trước khi ghi.
  - `findGuests` trả thêm `birthdate`; sự kiện `commerce.order.paid` vẫn giữ đúng hợp đồng cũ, không mang ngày sinh.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Lịch bộ nhớ không còn nạp toàn bộ mỗi 10 giây | Có | Lúc rảnh: CPU Postgres ~370% → ~0,5%, API ~40% → ~0% |
| Lịch vẫn cập nhật sau khi giữ chỗ | Có | Giữ 1 phòng, sau 12 giây trang khách sạn thấy số phòng giảm từ 3 xuống 2 |
| 1.000 CCU đạt ngưỡng p95 | Có | p95 giữ chỗ 216 → 46 ms, trả tiền 356 → 72 ms; 0 lỗi 5xx; 0 ô bán quá |
| Trả tiền không timeout khi quá tải | Có | Stress 1.000 → 5.000 CCU: timeout 36% → 0%, p50 9,9 → 0,44 giây (đo trên bản có cả K1–K4) |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected` (sau khi merge `develop`): 2.481 test qua, 2 hỏng, 4 bỏ qua.
- 2 test hỏng nằm ở `content/social` (giới hạn bình luận 2.000 ký tự). Test chờ `2,000` nhưng máy locale vi-VN trả `2.000`. Hỏng từ trước, không liên quan tới PR này.
- Test mới: `calendar-snapshot.spec.ts` (nạp phần đổi, tự nạp lại cả lịch khi quá 15 phút); `payment.use-cases.spec.ts` (trả tiền vừa chốt đơn thì không đọc lại).

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api db:migrate`, rồi bật core-api local.
2. Script đo nằm ngoài repo, trong `reports/do-tai-2026-11-16/` của Thắng: `load.mjs` (`SCENARIO=load|stress`), `check-delta.mjs`, `count-sql.mjs`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa trong `modules/commerce`. Thêm migration commerce mới, không sửa migration cũ. Không đổi API hay sự kiện.
