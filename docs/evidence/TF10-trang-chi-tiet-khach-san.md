# TF10 — Trang chi tiết khách sạn (web và app)

- Notion: <dán link task TF10> · Nhánh: `thang/TF10-trang-chi-tiet-khach-san` · Người làm: Thắng Nguyễn Lê Phúc (dùng AI: có) · Ngày: 2026-11-05

## Đã làm (phần backend, module commerce)
- `GET /api/hotels/:id?checkIn=&checkOut=&adults=&calendarDays=`: công khai, chỉ đọc. Trả ảnh, tên, sao, tỉnh thành; từng loại phòng với số phòng cần cho số khách, **số phòng thật còn lại** (không khan hiếm giả), lý do khi không đặt được, giá cả kỳ ở theo từng gói; lịch giá rẻ nhất từng ngày. Mặc định 1 đêm từ hôm nay, 2 khách, lịch 14 ngày. Sai tham số: 400 kèm tên trường; không có khách sạn: 404. Có trong `contracts/openapi/core-api.json`.
- Ảnh khách sạn lên S3 + CloudFront theo cách của nhóm (`libs/storage`):
  - Script `commerce/db/seed/upload-hotel-images.ts` tải đúng ảnh danh mục dùng (293 file) vào `<S3_KEY_PREFIX>images/hotels/...`; ảnh đã có cùng kích thước thì bỏ qua, chạy lại được; `--check` thử key AWS.
  - Đặt dưới `images/` vì CloudFront chỉ phát công khai `dev/*/images/*` và `dev/*/videos/*` (`deploy/aws/bucket-policy.template.json`).
  - Seed lưu **khoá đầy đủ** trong database (đúng quy ước khoá của `libs/storage`); API ghép `MEDIA_CDN_URL` để trả URL. Chưa đặt `MEDIA_CDN_URL` thì trả nguyên khoá. `listCatalog` của `CommerceFacade` cũng trả URL.

- Mở rộng dữ liệu trang chi tiết theo trang OTA thật (tham khảo Vinpearl Beachfront Nha Trang trên vinpearlota.com):
  - Migration mới `20261105102339_add_hotel_details` (chỉ `ADD COLUMN`, không sửa migration của TF06): `properties` thêm `address`, `lat`, `lng`, `rating_avg`, `review_count`, `rating_source`, `check_in_time`, `check_out_time`, `details` (JSONB: mô tả, điểm nổi bật, địa danh lân cận, tiện ích theo nhóm, ngôn ngữ, thông số, chính sách); `room_types` thêm `details` (giường, diện tích, hướng nhìn, ảnh phòng, tiện nghi phòng). Gói giá thêm `discountPct`, `perks` (không bắt buộc).
  - `GET /api/hotels/:id` chỉ **thêm** trường: `address`, `location`, `rating`, `checkInTime`, `checkOutTime`, `description`, `highlights`, `nearby`, `amenities`, `languages`, `facts`, `policies`; mỗi phòng thêm `bedType`, `areaM2`, `view`, `images`, `amenities`; mỗi gói thêm `listPricePerNight` (giá gạch), `discountPct`, `perks`. Giá gạch chỉ để hiển thị, **không đổi số tiền khách trả** (`pricePerNight`, `totalPrice` giữ nguyên cách tính). Khách sạn chưa có dữ liệu chi tiết trả `null` / mảng rỗng.
  - `catalog.json`: 220 khách sạn có thêm dữ liệu giả lập tất định (script do Codex viết, Claude chạy và soát): địa chỉ trên đường thật, toạ độ trong khu vực, địa danh thật của 42 tỉnh, 3.174 tiện ích, chính sách, chi tiết 642 loại phòng. Trường cũ và chuyến bay không đổi. **Khoảng cách tới địa danh và số nhà là số giả lập**, không phải số đo thật.

## Chưa làm / phụ thuộc người khác
- Giao diện app: `HotelScreen` ở nhánh `trang/mobile-ui` (Trang) đang dùng số cứng, cần gọi API trên.
- Giao diện web `/hotels/[id]` trong `tripflix-fe/apps/web` (Thành).
- "Vài bài nổi bật": cần hàm lấy bài theo `hotelId` từ content (Thành). Tạm chưa làm theo quyết định của người làm task.
- "Một chạm từ reel": feed cần mang `hotelId` (Phong).
- Ảnh đang ở `dev/thang/`; lên staging nên chuyển sang thư mục chung (cần Phong cấp quyền).

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng |
|---|---|---|
| Trang chi tiết có ảnh, giá hôm nay, tình trạng còn chỗ đúng | Đạt (API) | `hotels.e2e.spec.ts`; chạy thật `GET /api/hotels/P-h-dn-01` trả 5 ảnh URL CloudFront, giá từ 1.140.000đ |
| Ảnh hiển thị được trên web và app | Đạt (phía dữ liệu) | Mở URL ảnh qua CloudFront: HTTP 200, `image/jpeg`, 79 KB |
| Từ một reel bấm 1 lần tới trang chi tiết | Chưa | Phụ thuộc feed (Phong) và giao diện (Trang, Thành) |
| Vài bài nổi bật | Chưa | Phụ thuộc content (Thành) |

## Kết quả kiểm tra (mở rộng dữ liệu chi tiết, 05/11)
- `vitest run` (core-api): **240/240 pass**; test mới trong `hotels.e2e.spec.ts`: trả đủ trường chi tiết, giá gạch 1.000.000 / 0,65 → 1.540.000đ còn giá trả giữ 1.000.000đ; khách sạn chưa có dữ liệu chi tiết trả null.
- `vitest run --config vitest.int.config.ts` (Postgres thật): **23/23 pass**. `tsc --noEmit` pass, `oxlint` không có cảnh báo ở commerce, `check-boundaries` không vi phạm.
- Chạy thật: migrate + seed (220 khách sạn, 642 loại phòng), `GET /api/hotels/P-h-nt-01` trả 200 kèm địa chỉ, đánh giá 4.6 (759), 18 tiện ích (5 nổi bật), ảnh phòng qua CloudFront HTTP 200.
- `contracts/openapi/core-api.json` sinh lại bằng `export-openapi` (chỉ thêm trường).
- Lưu ý: seed lấy tiền tố ảnh từ `S3_KEY_PREFIX`; ảnh đang ở `dev/thang/`, nên seed với `S3_KEY_PREFIX=dev/thang/`.

## Kết quả kiểm tra (lần đầu)
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: lint 0 lỗi (53 cảnh báo đều ở `content`, không có ở commerce), typecheck pass, **221/221 test pass**.
- `pnpm --filter @tripflix/core-api test:int` (Postgres thật): **19/19 pass**.
- `node tools/check-boundaries.mjs`: không vi phạm.
- Tải ảnh: `upload-hotel-images.js`: 293 file, tải mới 293, khoảng 1 phút.

## Cách kiểm lại
1. `apps/core-api/.env`: đặt key AWS của mình, `S3_KEY_PREFIX=dev/<tên>/`, `MEDIA_CDN_URL` (xem `deploy/aws/README.md`).
2. `pnpm --filter @tripflix/core-api build`
3. Trong `apps/core-api`: `node dist/modules/commerce/db/seed/upload-hotel-images.js <thư mục images của datamock>` (thử trước bằng `--check`).
4. `pnpm db:migrate`, `pnpm db:seed`, chạy core-api, gọi `GET /api/hotels/P-h-dn-01`, mở URL trong `thumbnail`.

## Ảnh / video
- Chưa có: chờ giao diện web và app nối API.

## Ảnh hưởng tới phần của người khác
- `apps/core-api/src/cli/seed.ts` (Dũng): đoạn seed commerce truyền thêm tiền tố khoá ảnh `S3_KEY_PREFIX`; không đổi phần seed tài khoản.
- Dùng `S3ObjectStorage` của `libs/storage` (Phong) đúng README, không sửa `libs/`.
- Nhánh này chứa cả TF06: mở PR sau khi TF06 đã merge vào `develop`.
