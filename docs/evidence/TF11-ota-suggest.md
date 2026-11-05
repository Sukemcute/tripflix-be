# TF11 — Tìm kiếm trên web (phần 1: gợi ý ở ô tìm web OTA)

- Notion: https://app.notion.com/40dcb9b9e5c281708194d0561df200cd · Jira: SCRUM-15 · Nhánh: `duy/TF11-ota-suggest` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-05

> **Evidence tiến độ, task chưa xong.** Nhánh này chỉ có phần gợi ý khi gõ (`GET /api/suggest`) và các luồng đã chốt cho phần còn lại. Tiêu chí "Xong khi" của TF11 chưa đạt (xem bảng dưới).

## Đã làm

- `GET /api/suggest?q=&types=`: ô tìm của web đặt chỗ gợi ý địa điểm, khách sạn, sân bay theo tên. Tối đa 8 dòng lẫn loại (khoảng 3 địa điểm, 4 khách sạn, 1 sân bay). Khớp không dấu, gõ tắt (`pq`, `hcm`, `sg`), gõ sai nhẹ (`nha trag`, `da nng`). Khớp đầu từ xếp trước khớp gần đúng; câu ngắn hơn 4 ký tự chỉ khớp đầu từ để tránh kết quả rác.
- Bảng `discovery.search_entities` có GIN `pg_trgm`. Migration `20261104095405_init_search_entities` tạo schema `discovery` và extension `pg_trgm`.
- Cây địa điểm v1 trong `search/domain/`: 34 tỉnh, 8 điểm đến mà commerce dùng làm `provinceSlug`, 22 sân bay. Chỉ lọc theo tỉnh, vì commerce chưa có toạ độ.
- Job dựng lại chỉ mục khi worker khởi động (`APP_ROLE` là `worker` hoặc `all`). Lỗi job không chặn khởi động.
- Khách sạn: cổng `HOTEL_CATALOG` hiện là danh mục rỗng. Khi TF06 merge thì nối `CommerceFacade.listCatalog`.
- Swagger có mô tả đầy đủ; đã sinh lại `contracts/openapi/core-api.json`.
- Ghi các luồng đã chốt (vào/ra, gọi module nào, nạp dữ liệu thế nào) cho `/suggest`, `/stays`, `/search/stays`, `/search/posts` ở `apps/core-api/src/modules/discovery/README.md`. Trong đó: v1 không dùng sự kiện, không nghe `commerce.ari.updated`, `/stays` gọi thẳng commerce.

## Đối chiếu "Xong khi"

| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng |
|---|---|---|
| Gõ kiểu người trẻ trên web vẫn ra kết quả đúng, không vượt ngân sách | **Chưa** | Mới có phần gợi ý theo tên (không dấu, gõ tắt, gõ sai nhẹ): `suggest-entity.spec.ts`, `normalize-text.spec.ts`, kiểm tay bên dưới. Chưa có trang kết quả (`/stays`, chờ TF06), chưa tách ngân sách và số người |

## Kết quả kiểm tra

`pnpm turbo run lint typecheck test --filter=@tripflix/core-api` sau khi merge `origin/develop`: 12/12 task thành công, **146/146 test pass** (17 file), lint 0 lỗi (43 cảnh báo, không cái nào trong `discovery`). Riêng discovery có 16 test: `normalize-text` 3, `suggest-entity` 10, `suggest.use-cases` 3.

Kiểm tay trên máy local (Postgres thật, chưa có khách sạn):

| Gõ | Ra đầu tiên |
|---|---|
| `da lat`, `Đà Lạt` | Đà Lạt (Lâm Đồng), sân bay Liên Khương |
| `pq` | Phú Quốc, sân bay PQC |
| `hcm` | TP. Hồ Chí Minh, sân bay Tân Sơn Nhất |
| `nha trag`, `nha trg` | Nha Trang |
| `da nag`, `da nng` | Đà Nẵng (trước sân bay) |
| `DAD` | Sân bay Đà Nẵng |

## Cách kiểm lại

1. `pnpm stack:up` (hoặc chạy Postgres rồi `pnpm db:migrate`), chạy `core-api` với `APP_ROLE=all`.
2. Log có dòng dựng chỉ mục gợi ý (số dòng, thời gian).
3. `curl "http://localhost:3000/api/suggest?q=da%20lat"`, thử thêm các câu ở bảng trên. `q` 1 ký tự thì trả 400.
4. Swagger: `/docs`, nhóm `discovery`.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không sửa code của người khác. `contracts/openapi/core-api.json` sinh lại bằng `pnpm contracts:build` (chỉ thêm `/api/suggest`).
- Phụ thuộc: chờ TF06 (Thắng) merge để có khách sạn; `/search/posts` cần `ContentFacade.listPosts({ updatedAfter, cursor })` (Thành, Phong).
