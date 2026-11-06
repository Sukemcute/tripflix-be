# TF29 — Bổ sung thông tin tìm chuyến bay

- Notion: <dán link task TF29> · Nhánh: `thang/TF29-bo-sung-chuyen-bay` · Người làm: Thắng Nguyễn Lê Phúc (dùng AI: có) · Ngày: 2026-11-06

## Đã làm (module commerce)
Theo góp ý của Trang khi dựng màn tìm chuyến bay (so với giao diện mẫu kiểu Vietjet: giờ đi/đến, số hiệu, hành lý, dải ngày kèm giá).

- **Sửa seed:** 20 chuyến (`P-cm-auto-…`, `P-f-…`, 41 dòng hạng ghế) thiếu giờ đến, nên FE hiện `--:--`. Giờ đến tính bằng giờ đi + thời gian bay của các chuyến khác cùng tuyến trong dữ liệu.
- **Thêm cột** (migration `20261106080356_add_flight_numbers`, chỉ `ADD COLUMN`):
  - `flights.airline_code`: mã IATA VJ, VN, QH, VU, BL, để FE gắn logo.
  - `flights.flight_number`: ví dụ VJ125, không trùng giữa các chuyến; các hạng ghế của cùng chuyến dùng chung số.
  - `flights.stops`: mặc định 0, tức bay thẳng.
- **Hành lý theo gói vé** (`fare_plans`, thêm `carryOnKg`, `checkedKg`):
  - Hãng giá rẻ (VJ, VU, BL), hạng phổ thông: gói tiết kiệm 7 kg xách tay, không ký gửi; gói linh hoạt thêm 20 kg ký gửi.
  - VN, QH: 10 kg xách tay và 23 kg ký gửi; gói linh hoạt ký gửi 30 kg.
  - Phổ thông đặc biệt và thương gia có mức cao hơn.
  - Đây là số giả lập, không phải chính sách thật của hãng.
- **`GET /api/flights` và `GET /api/flights/:id` chỉ thêm trường:**
  - `airlineCode`, `flightNumber`
  - `durationMinutes`: tính từ giờ đi, giờ đến, chuyến qua nửa đêm vẫn tính đúng
  - `stops`, `cabinCode` (Y, W, J)
  - `isPriceTaxIncluded`: luôn `true`, vì giá đã là giá trọn gói
  - Mỗi gói vé thêm `carryOnKg`, `checkedKg`
- **Tham số `sort`** cho `GET /api/flights`: `recommended` (mặc định, giữ cách xếp cũ), `price`, `departure`, `duration`. Chuyến hết ghế luôn ở cuối.
- **Endpoint mới `GET /api/flights/calendar?from&to&start&end&passengers`:**
  - Trả giá một vé rẻ nhất từng ngày trên tuyến, tối đa 31 ngày, để làm dải ngày "From 1.804k".
  - Chỉ đọc lịch một lần cho cả khoảng ngày, tính đủ chỗ cho số khách.
  - Ngày hết chỗ hoặc chưa mở bán thì `priceFrom: null`.

## Chưa làm
- **Khứ hồi** (Outbound/Return): checkout hiện chỉ nhận một chuyến, phải sửa cả luồng đặt và thanh toán. Cần task riêng.
- **Hành khách trẻ em, em bé:** cần quy tắc giá riêng, task riêng.
- **Lọc giờ bay, lọc hãng phía server:** dữ liệu trả về đã đủ để FE lọc phía trình duyệt.
- **Chuyến có điểm dừng:** dữ liệu hiện chỉ có chuyến bay thẳng (`stops` = 0).

## Kết quả kiểm tra
- `vitest run` (core-api): commerce 49/49 pass, có 4 test mới trong `flight-search.use-cases.spec.ts`:
  - Trường mới, thời gian bay qua nửa đêm, dữ liệu cũ thiếu trường thì trả null.
  - Các kiểu `sort`, chuyến hết ghế luôn ở cuối, `sort` sai thì báo lỗi.
  - Lịch giá theo ngày và theo số khách, ngày dừng bán, ngày chưa mở bán.
  - Khoảng ngày sai, quá 31 ngày, ngày quá khứ.
- Toàn bộ core-api: 633 pass, 2 fail ở `content/social` (giới hạn 2.000 ký tự). Hai test này lỗi sẵn trên develop, không do nhánh này: phần `content` giống hệt develop.
- `vitest run --config vitest.int.config.ts` (Postgres thật): 91/91 pass. `tsc --noEmit` pass, `oxlint` sạch ở commerce, `check-boundaries` không vi phạm.
- Chạy thật (migrate + seed, `GET` trên core-api):
  - `/api/flights/calendar?from=HAN&to=SGN&start=…&end=…` (7 ngày): đủ 7 ngày có giá.
  - `/api/flights?from=HAN&to=SGN&sort=price`: ví dụ VJ125 19:40–21:40, 120 phút, bay thẳng, hạng Y, hành lý `[["ECO",7,0],["FLEX",7,20]]`.
  - Không còn chuyến thiếu giờ đến; CXR–HAN đã có giờ đến.
  - Khoảng ngày quá 31 ngày trả 400.
- `contracts/openapi/core-api.json` sinh lại bằng `export-openapi` (chỉ thêm).

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api build`, `pnpm db:migrate`, `S3_KEY_PREFIX=dev/thang/ pnpm db:seed`.
2. Gọi `GET /api/flights/calendar?from=HAN&to=SGN&start=<hôm nay>&end=<hôm nay + 6>`.
3. Gọi `GET /api/flights?from=HAN&to=SGN&date=<ngày>&sort=price`.

## Ảnh / video
- Không đổi giao diện (chỉ backend).

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `modules/commerce` và sinh lại `contracts/openapi/core-api.json`; API chỉ thêm trường. FE (Trang, Thành) chạy `pnpm gen:api` để dùng.
