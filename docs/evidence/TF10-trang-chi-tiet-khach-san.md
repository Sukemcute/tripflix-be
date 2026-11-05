# TF10 — Trang chi tiết khách sạn (web và app)

- Notion: <dán link task TF10> · Nhánh: `thang/TF10-trang-chi-tiet-khach-san` · Người làm: Thắng Nguyễn Lê Phúc (dùng AI: có) · Ngày: 2026-11-05

## Đã làm (phần backend, module commerce)
- `GET /api/hotels/:id?checkIn=&checkOut=&adults=&calendarDays=`: công khai, chỉ đọc. Trả ảnh, tên, sao, tỉnh thành; từng loại phòng với số phòng cần cho số khách, **số phòng thật còn lại** (không khan hiếm giả), lý do khi không đặt được, giá cả kỳ ở theo từng gói; lịch giá rẻ nhất từng ngày. Mặc định 1 đêm từ hôm nay, 2 khách, lịch 14 ngày. Sai tham số: 400 kèm tên trường; không có khách sạn: 404. Có trong `contracts/openapi/core-api.json`.
- Ảnh khách sạn lên S3 + CloudFront theo cách của nhóm (`libs/storage`):
  - Script `commerce/db/seed/upload-hotel-images.ts` tải đúng ảnh danh mục dùng (293 file) vào `<S3_KEY_PREFIX>images/hotels/...`; ảnh đã có cùng kích thước thì bỏ qua, chạy lại được; `--check` thử key AWS.
  - Đặt dưới `images/` vì CloudFront chỉ phát công khai `dev/*/images/*` và `dev/*/videos/*` (`deploy/aws/bucket-policy.template.json`).
  - Seed lưu **khoá đầy đủ** trong database (đúng quy ước khoá của `libs/storage`); API ghép `MEDIA_CDN_URL` để trả URL. Chưa đặt `MEDIA_CDN_URL` thì trả nguyên khoá. `listCatalog` của `CommerceFacade` cũng trả URL.

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

## Kết quả kiểm tra
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
