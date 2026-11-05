# TF11 — Tìm kiếm trên web (phần 1: ô tìm và trang kết quả web OTA)

- Notion: https://app.notion.com/40dcb9b9e5c281708194d0561df200cd · Jira: SCRUM-15 · Nhánh: `duy/TF11-ota-suggest` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-05

> **Evidence tiến độ, task chưa xong.** Nhánh này có ô tìm (`GET /api/suggest`) và trang kết quả (`GET /api/stays`) của web đặt chỗ, cùng các luồng đã chốt cho phần còn lại. Tiêu chí "Xong khi" của TF11 (gõ kiểu người trẻ, không vượt ngân sách) chưa đạt: phần tách ngân sách, số người từ câu là của luồng app, làm sau.

## Đã làm

- `GET /api/suggest?q=&types=`: ô tìm của web đặt chỗ, gợi ý địa điểm, khách sạn, sân bay theo tên.
  - Tối đa 8 dòng lẫn loại (khoảng 3 địa điểm, 4 khách sạn, 1 sân bay).
  - Khớp không dấu, gõ tắt (`pq`, `hcm`, `sg`), gõ sai nhẹ (`nha trag`, `da nng`).
  - Khớp đầu từ xếp trước khớp gần đúng. Câu ngắn hơn 4 ký tự chỉ khớp đầu từ, để tránh kết quả rác.
  - Đọc bảng `discovery.search_entities` (GIN `pg_trgm`). Migration `20261104095405_init_search_entities` tạo schema `discovery` và extension `pg_trgm`.
  - Chỉ mục dựng lại khi worker khởi động (`APP_ROLE` là `worker` hoặc `all`). Khách sạn lấy từ `CommerceFacade.listCatalog`. Lỗi job không chặn khởi động.
- `GET /api/stays?placeId&checkIn&checkOut&adults&...`: trang kết quả, khách sạn **còn phòng** ở một nơi cho ngày đã chọn.
  - Đổi `placeId` thành các `provinceSlug`. Chọn tỉnh thì gồm cả điểm đến con (Lâm Đồng gồm Đà Lạt).
  - Gọi `commerce.listCatalog({ provinceSlug })` để lấy khách sạn, rồi `commerce.checkAvailability` theo lô tối đa 100 mã để lấy còn phòng và giá thật.
  - Bỏ chỗ hết phòng, lọc `minStars`, `priceMin`, `priceMax`, sắp `price` hoặc `stars`, phân trang `cursor`/`limit`.
  - Không giữ bản sao, không trả `remaining`.
  - Nơi lạ, ngày sai thì 400. Lỗi `invalid_query` của commerce được đổi thành 400.
- Cây địa điểm v1 trong `search/domain/`: 34 tỉnh, 8 điểm đến mà commerce dùng làm `provinceSlug`, 22 sân bay. Chỉ lọc theo tỉnh, vì commerce chưa có toạ độ.
- `DiscoveryModule` import `CommerceModule`, gọi qua `index.ts` (một chiều, trong tiến trình). `tools/check-boundaries.mjs`: không vi phạm.
- Swagger có mô tả đầy đủ; đã sinh lại `contracts/openapi/core-api.json`.
- Ghi các luồng đã chốt (vào/ra, gọi module nào, nạp dữ liệu thế nào) cho `/suggest`, `/stays`, `/search/stays`, `/search/posts` ở `apps/core-api/src/modules/discovery/README.md`. Trong đó: v1 không dùng sự kiện, không nghe `commerce.ari.updated`, `/stays` gọi thẳng commerce.

## Đối chiếu "Xong khi"

| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng |
|---|---|---|
| Gõ kiểu người trẻ trên web vẫn ra kết quả đúng, không vượt ngân sách | **Một phần** | Web OTA: gõ không dấu, tắt, sai nhẹ vẫn ra đúng nơi hoặc khách sạn (`suggest-entity.spec.ts`, `normalize-text.spec.ts`, kiểm tay); trang kết quả lọc cứng theo `priceMax` (`stays.spec.ts`). Chưa có tách ngân sách và số người từ câu tự do |

## Kết quả kiểm tra

`pnpm turbo run lint typecheck test --filter=@tripflix/core-api` (đã merge `origin/develop` tới `3b724c7`, có TF06): lint 0 lỗi, không cảnh báo nào trong `discovery`; typecheck pass; **186/186 test pass** (22 file).

Ghi chú: khi chạy test cùng lúc với server local, `access/auth.e2e.spec.ts` ("sai quá 5 lần thì 429") có lần vượt timeout 5 s, vì băm argon2 chậm khi máy tải nặng. Tắt server rồi chạy lại thì pass. Lỗi này không liên quan tới discovery.

Test mới của discovery:
- `stays.spec.ts` (7): cây nơi, lọc, sắp, phân trang.
- `stays.use-cases.spec.ts` (4): gộp tỉnh và điểm đến, bỏ hết phòng, lô 100 mã, nơi lạ, nơi rỗng.

Kiểm tay trên máy local, seed commerce có 220 khách sạn. Chỉ mục gợi ý có 284 dòng, dựng trong 172 ms.

| Gọi | Kết quả |
|---|---|
| `/suggest?q=vinpearl` | 8 khách sạn Vinpearl, dòng phụ là nơi ("Hội An, Đà Nẵng") |
| `/suggest?q=da lat` | Đà Lạt, 3 khách sạn ở Đà Lạt, sân bay Liên Khương |
| `/stays?placeId=lam-dong&…&adults=2` | 10 khách sạn của `lam-dong` và `da-lat`, rẻ trước, giá thật một đêm và cả kỳ |
| `/stays?placeId=da-lat&sort=stars&minStars=4&limit=2` | 2 khách sạn 5 sao, có `nextCursor` |
| `/stays?placeId=atlantis…` / `checkIn` quá khứ / `checkOut ≤ checkIn` | 400 kèm `field` và lý do |
| `/stays?placeId=ho-chi-minh…` (3 slug) | 0,24 s |

## Cách kiểm lại

1. `pnpm stack:infra`, `pnpm build`, `pnpm db:migrate`, `pnpm db:seed`.
2. Chạy `core-api` với `APP_ROLE=all`; log có dòng "Đã dựng chỉ mục gợi ý: … dòng".
3. `curl "http://localhost:3000/api/suggest?q=da%20lat"`.
4. `curl "http://localhost:3000/api/stays?placeId=lam-dong&checkIn=<ngày tới>&checkOut=<ngày tới + 2>&adults=2"`.
5. Swagger: `/docs`, nhóm `discovery`.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không sửa code của người khác. Chỉ gọi `CommerceFacade` (Thắng) qua `commerce/index.ts`.
- `contracts/openapi/core-api.json` sinh lại bằng `pnpm contracts:build` (chỉ thêm `/api/suggest`, `/api/stays`).
- Còn chờ: `/search/posts` cần `ContentFacade.listPosts({ updatedAfter, cursor })` (Thành, Phong).
