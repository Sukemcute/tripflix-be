# TF11 — Tìm khám phá bằng lời (phần backend)

- Jira: [SCRUM-15](https://tripflix.atlassian.net/browse/SCRUM-15) · Notion: [TF11](https://app.notion.com/40dcb9b9e5c281708194d0561df200cd) · Nhánh: `duy/TF11-tim-kham-pha` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-06

## Đã làm (module discovery)
- **`POST /api/search`** (công khai): `{ q, loc? }` → câu đã hiểu (`place`, `intents`, `budget`, `days`, `names`, `fixed`, `phrases`) và kết quả chia vùng (Ở đâu, Lộ trình, Bài, Video; Ăn/Cà phê/Chơi để sẵn, rỗng tới khi có nguồn POI). Không có kết quả thì trả `suggest`. `loc` chỉ dùng khi câu không nói nơi ("gần tôi").
- **Engine TypeScript** trong `search/domain/explore/` (thuần, không Nest/Drizzle), port từ prototype Python `experiments/natural-search` để Docker không phải thêm Python:
  - chuẩn hoá kiểu người trẻ: không dấu, viết tắt (`ks`, `cf`, `q1`, `3n2đ`), lexicon 311 dòng (nơi, ý muốn, tầm giá, từ lóng);
  - ngân sách ("dưới 500k", "1tr5") là **lọc cứng** cho mọi mục có giá;
  - sửa lỗi gõ theo dữ liệu (không sửa từ người dùng gõ có dấu đúng dạng âm tiết, vd "dịp");
  - tên riêng (tên đường, chuỗi khách sạn) và cụm dính (NPMI) học từ dữ liệu;
  - chấm BM25 + độ phủ + chất lượng + độ gần; các nhánh chạy song song.
- **Chỉ mục trên Postgres**, schema `discovery`: bảng `search_documents` (cột lọc + `terms text[]` GIN) và `search_counts` (mọi thống kê). Migration `20261105182102_explore_index` (chỉ `CREATE TABLE`/index).
- **Job dựng lại** mỗi 10 phút trên worker (`rebuild-explore-index.job.ts`): gọi `commerce.listCatalog` + `content.listPosts`, ghi lại trong một transaction có advisory lock. Bài bị ẩn lọc lại lúc trả bằng `content.getVisiblePosts`.
- `commerce.listCatalog` trả thêm `address`, `location` (chỉ thêm trường; phần của Thắng, đã báo).
- `contracts/openapi/core-api.json` sinh lại (chỉ thêm).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Gõ kiểu người trẻ vẫn ra kết quả đúng | Đạt phần backend | `explore.spec.ts` (16 test chép từ prototype); `explore.parity.spec.ts`: 134/134 câu trùng kết quả Python; stack local: "ks da lat duoi 500k", "cf q1 chill", "lịch trình đà lạt 3n2đ" hiểu đúng nơi/ngân sách/số ngày |
| Không vượt ngân sách | Đạt | lọc cứng ở `rank.ts`; test "chỉ hiện kết quả khớp; ngân sách là lọc cứng" (gồm video kèm lộ trình); stack local: 0 mục vượt ngân sách ở 3 câu có ngân sách |
| Trên web | **Chưa** | Giao diện web (Thành) chưa làm; API đã sẵn trong contracts |

Khác mô tả task: chưa gọi `POST /parse-query` của AI (bộ hiểu câu dùng lexicon + thống kê, ~12 ms, không tốn LLM); chưa nghe `commerce.ari.updated` (dựng lại theo chu kỳ). Xem `docs/proposals/explore-search-architecture.md` ở workspace.

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api` sau khi merge `origin/develop`: lint 0 lỗi, typecheck pass; test 396/401 pass, 1 skip, **4 fail ở `access/*.e2e.spec.ts`** (account, auth, staff — của Dũng) do chạy song song; chạy riêng 3 file đó 2 lần: 17/17 pass. Không liên quan nhánh này.
- Discovery: 10 file, 53/53 pass, kể cả đối chiếu với Python (`EXPLORE_PARITY_DIR=<experiments/natural-search>`).
- Stack local (220 khách sạn, 10 bài): trung vị ~12 ms mỗi câu khi đã ấm.

## Cách kiểm lại
1. `pnpm stack:up`, chờ worker dựng chỉ mục (log `Đã dựng chỉ mục tìm khám phá: N mục`).
2. `POST localhost:8080/api/search` với `{"q":"homestay đà lạt dưới 1 triệu"}` → vùng `stay`, mọi `priceFrom` ≤ 1.000.000.
3. Đối chiếu Python (cần dữ liệu prototype, không ở repo): `EXPLORE_PARITY_DIR=<đường dẫn> pnpm --filter @tripflix/core-api exec vitest run src/modules/discovery`.

## Ảnh / video
- Chưa có: chưa có giao diện.

## Ảnh hưởng tới phần của người khác
- `commerce/inventory` (Thắng): `CatalogHotel` thêm `address`, `location` (chỉ thêm, test commerce cập nhật theo).
- `discovery.module.ts` import `ContentModule` (gọi facade content một chiều, đúng `module-communication.md`).
