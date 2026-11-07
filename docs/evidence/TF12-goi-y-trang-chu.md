# TF12 — Khối "Gợi ý dành cho bạn" trên trang chủ web (phần BE)

- Notion: https://app.notion.com/40dcb9b9e5c2812eb772e44063a4c66c · Jira: SCRUM-16 · Nhánh: `duy/TF12-api-goi-y-trang-chu` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-08

## Đã làm

- `GET /api/recommendations/home?recentPlaceIds=&limit=` (công khai, không cần đăng nhập, server không lưu gì về người dùng).
- Cập nhật hợp đồng dữ liệu theo cụm điểm đến (`HomeDestinationPick`):
  - Mỗi điểm đến trả về danh sách khách sạn deal hời (`hotels: HomeStayPick[]`), kèm `totalDealsCount` và `otherDealsCount` (số khách sạn có deal hời còn lại tại điểm đến đó để phục vụ hiển thị trên web).
  - Khách sạn kèm lý do deal hời `reason { code: 'good_deal', text: 'Rẻ hơn X% so với...' }`.
- Cải tiến thuật toán chọn điểm đến và tính deal hời:
  - Tính median theo tỉnh thành (`local median`) khi tỉnh có từ 3 khách sạn cùng hạng sao, giúp phản ánh chính xác deal hời tại các điểm du lịch cao cấp (Phú Quốc, Nha Trang, Hội An...).
  - Ưu tiên hiển thị bộ điểm đến du lịch trọng điểm của Việt Nam (`Đà Lạt, Nha Trang, Phú Quốc, Đà Nẵng, Hội An, Quảng Ninh/Hạ Long...`) trong danh sách gợi ý mặc định.
- Đồng bộ OpenAPI contract: `contracts/openapi/core-api.json`.

## Đối chiếu "Xong khi"

| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng |
|---|---|---|
| Trang chủ web có khối gợi ý kèm lý do | Đạt phần BE | API trả danh sách điểm đến kèm danh sách khách sạn có deal hời và số lượng deal còn lại |

## Kết quả kiểm tra

- `pnpm --filter @tripflix/core-api test -- src/modules/discovery`: 10/10 test files (55 passed, 1 skipped) pass trong 3.4s.
- `node tools/check-boundaries.mjs`: Không có vi phạm ranh giới kiến trúc.

Kiểm tay trên local:
`GET http://localhost:3000/api/recommendations/home?limit=6`:
- Trả về 6 điểm đến: Đà Lạt, Nha Trang, Phú Quốc, Đà Nẵng, Quảng Nam (Hội An), Quảng Ninh.
- Mỗi điểm đến có đầy đủ `hotels`, `totalDealsCount`, `otherDealsCount`.

## Cách kiểm lại

1. `pnpm install`, `pnpm stack:up` (hoặc chỉ Postgres, core-api).
2. Chạy `pnpm --filter @tripflix/core-api test -- src/modules/discovery`.
3. Gọi `curl http://localhost:3000/api/recommendations/home?limit=6`.

## Ảnh / video

- Chưa có (phần backend API).

## Ảnh hưởng tới phần của người khác

- Đổi contract OpenAPI: đã chạy `pnpm contracts:build` và cập nhật `contracts/openapi/core-api.json`. Phía FE đã đồng bộ `api-client` tương thích.

