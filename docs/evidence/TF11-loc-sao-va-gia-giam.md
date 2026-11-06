# TF11 — `GET /api/stays`: lọc đúng hạng sao và sắp giá cao trước

- Jira: [SCRUM-15](https://tripflix.atlassian.net/browse/SCRUM-15) · Nhánh: `duy/TF11-loc-sao-va-gia-giam` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-06
- Yêu cầu từ Bảo (trang tìm khách sạn web, FE PR #30).

## Đã làm (module discovery, chỉ thêm)

- **Tham số `stars`** (1–5, không bắt buộc): lọc đúng một hạng sao.
  - `minStars` giữ nguyên nghĩa "từ X sao trở lên".
  - Gửi cả hai thì áp cả hai điều kiện.
  - Khách sạn chưa xếp hạng không bao giờ khớp `stars`.
- **`sort=price_desc`**: sắp giá cao trước. Cùng giá thì xếp theo tên A→Z để thứ tự giữa các trang ổn định. `price` (mặc định) và `stars` không đổi.
- Phải làm ở BE vì lọc và sắp xếp chạy trước bước chia trang (`limit`/`cursor`). FE tự lọc thì `total` và số trang sẽ sai.
- `contracts/openapi/core-api.json` sinh lại. Chỉ thêm: tham số `stars`, giá trị enum `price_desc`, mô tả.

## Đối chiếu yêu cầu

| Yêu cầu | Đạt | Bằng chứng |
|---|---|---|
| `stars=3` không ra 4★, 5★ | Đạt | Test "lọc đúng một hạng sao..."; stack local Lâm Đồng: `stars=4` → 5 mục đều 4★; `stars=3` → 0 (Lâm Đồng không có khách sạn 3★) |
| `sort=price_desc` đúng trên mọi trang | Đạt | Test "price_desc..."; stack local `limit=4`: 3 trang `[3,35tr; 3,22tr; 2,94tr; 2,6tr] [2,28tr; 2,05tr; 1,42tr; 1,29tr] [650k; 560k]`, `total` 10 |
| Không đổi gì cũ | Đạt | `minStars`, `sort=price`, `stars` trả như trước; `stars=6` → 400 |

## Kết quả kiểm tra

- `vitest run src/modules/discovery`: 54 pass, 1 skip (bài đối chiếu với Python, cần dữ liệu prototype).
- `pnpm turbo run lint typecheck --filter=@tripflix/core-api`: 12/12 task pass.

## Cách kiểm lại

1. `pnpm stack:up`.
2. `GET localhost:8080/api/stays?placeId=lam-dong&checkIn=2026-12-01&checkOut=2026-12-03&adults=2&stars=4` → mọi `stars` = 4.
3. Cùng URL, bỏ `stars`, thêm `&sort=price_desc&limit=4`, rồi đi theo `nextCursor` → giá giảm dần qua các trang.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không. Chỉ sửa trong `discovery`. FE (Bảo) cần chạy `pnpm gen:api` để lấy `stars` và `price_desc`.
