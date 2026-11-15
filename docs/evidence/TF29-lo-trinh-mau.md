# TF29: lộ trình mẫu có chặng đi lại cho 10 bài seed

## Mục đích
Tab "Đặt" trên app đặt được vé bay và khách sạn theo lộ trình của bài. 10 bài seed trước đây chỉ gắn khách sạn, chưa có chặng đi lại, nên chỉ demo được phần đặt khách sạn.

## Đã làm
- `apps/core-api/src/modules/content/db/seed/posts-seed.json`: thêm chặng đi lại (`items[].transport`) cho cả 10 bài, chỉ thêm dữ liệu, không đổi schema.
  - Chặng bay dùng tuyến đang bán trong seed commerce: SGN/HAN/HPH ⇄ DAD, PQC, DLI, CXR, VDO.
  - Chặng không bán vé (taxi, xe khách, tàu, limousine) để `mode` là `car`, `bus`, `train`, app hiện là "Tự túc".
  - Hai bài ngắn (VinWonders, Hòn Tre) thêm `daysCount`, chi phí ước tính và hoạt động theo ngày.
- Seed content dùng `onConflictDoUpdate` cho `trip_attachment`, nên chạy lại seed là cập nhật bài đã có, không tạo trùng.

## Kiểm tra
- `vitest run src/modules/content/db/seed`: 5/5 pass.
- Chạy seed content trên DB local: 10/10 bài có chặng đi lại.
- 18 chặng bay đều còn vé ngày 27/11 đến 30/11/2026 (gọi `GET /api/flights` local, 2 người lớn).

## Sau khi merge
Server cần chạy lại seed content để bài có lộ trình mới.
