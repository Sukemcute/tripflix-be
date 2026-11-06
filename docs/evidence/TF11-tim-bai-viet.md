# TF11 — `POST /api/search/posts`: tìm bài bằng câu tự nhiên, có phân trang

- Jira: [SCRUM-15](https://tripflix.atlassian.net/browse/SCRUM-15) · Nhánh: `duy/TF11-tim-bai-viet` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-06
- Theo đề xuất của Thành (tìm bài trên app và web Cảm hứng, C19 trong `prd-alignment`: tìm bài đi qua discovery).

## Đã làm (module discovery, chỉ thêm)

- **`POST /api/search/posts`**, công khai.
  - Request: `{ q, postType?: 'all' | 'plan' | 'video' | 'post' (mặc định all), cursor?, limit? (1–50, mặc định 20) }`.
  - Response: `{ understood, items, total, nextCursor }`.
  - Item cùng kiểu với `POST /api/search`.
- **Cùng engine, cùng chỉ mục** với `/api/search`:
  - `searchExplore` nhận thêm `fullKinds`: các vùng bài luôn lấy đủ mục, kể cả khi câu nhắm vùng khác (vd "khách sạn đà nẵng").
  - Engine giữ nguyên cách chấm; đối chiếu với bản Python vẫn khớp hết.
- `postType=all`: gộp Lộ trình → Video → Bài viết theo thứ tự engine xếp. Video kèm lộ trình chỉ trả một lần.
- Bài bị ẩn hoặc xoá được lọc qua `content.getVisiblePosts` **trước** khi chia trang, nên `total` và số trang đúng.
- `reason` của danh sách bài luôn có số ngày (nếu có lộ trình) và lượt thích, vd `3 ngày · Ở Đà Nẵng · ~2.5tr/người · ♥ 120`.
- Phân trang theo vị trí trên danh sách xếp lại mỗi lần gọi (cùng cách `/api/stays`). Giới hạn 1.000 bài khớp, ghi `ponytail:` để sau chuyển sang phân trang trong engine.
- `contracts/openapi/core-api.json` sinh lại (chỉ thêm).

**Không làm:**
- Sync cộng dồn theo `updatedAfter`: chỉ mục có thống kê trên toàn bộ dữ liệu (độ hiếm từ, cụm từ, sửa lỗi gõ), nên dựng lại toàn bộ vẫn đúng và rẻ ở quy mô hiện tại.
- Ảnh bìa bài: `listPosts` mới có `coverMediaId`, đang hỏi Thành.

## Đối chiếu yêu cầu

| Yêu cầu | Đạt | Bằng chứng |
|---|---|---|
| Tìm bài bằng câu tự nhiên, lọc `postType` | Đạt | `explore.use-cases.spec.ts` "tìm bài: phân trang, lọc postType..." |
| Phân trang `cursor` / `total` | Đạt | Cùng test: 4 bài khớp, `limit 2` → 2 trang, trang cuối `nextCursor: null` |
| Bỏ bài ẩn/xoá | Đạt | Cùng test: bài ẩn không có trong `total` lẫn `items` |
| Ngân sách là lọc cứng | Đạt | Cùng test: "lịch trình đà nẵng dưới 2tr" với lộ trình 2,5 tr → `total 0` |
| `/api/search` không đổi | Đạt | Test cũ của `/api/search` pass; đối chiếu với Python khớp hết |

## Kết quả kiểm tra

- `vitest run src/modules/discovery`: 55 pass, 1 skip (bài đối chiếu Python khi không có dữ liệu prototype).
- Có dữ liệu prototype (`EXPLORE_PARITY_DIR`): `domain/explore` 17/17 pass, gồm đối chiếu 134 câu.
- `pnpm turbo run lint typecheck --filter=@tripflix/core-api`: 12/12 task, 0 lỗi lint (warning đều ở module khác).
- **Stack local** (code nhánh nạp vào container core-api, 10 bài seed), 18–75 ms mỗi câu:
  - `"lich trinh da lat 3n2d"` → 1 bài (video Săn mây Đà Lạt, có ở cả Lộ trình và Video, chỉ trả một lần), `reason` "3 ngày · Ở Đà Lạt · ♥ 109";
  - `"nha trang"`, `limit 1` → 3 trang (1 lộ trình, 2 video), `total` 3, trang cuối `nextCursor: null`;
  - `"đà lạt"`, `postType video` → 1 video;
  - `"lịch trình đà lạt dưới 2tr"`, `postType plan` → 0 (lộ trình 3,1 tr/người vượt ngân sách);
  - `"khách sạn đà nẵng"` → vẫn ra lộ trình Đà Nẵng (bài không bị giới hạn 3 mục như ở `/api/search`);
  - `postType: "reel"`, `cursor: "abc"`, `q: "  "` → 400 đúng trường.

## Cách kiểm lại

1. `pnpm stack:up`, chờ worker dựng chỉ mục.
2. `POST localhost:8080/api/search/posts` với `{"q":"đà lạt"}` → `items` là bài ở Đà Lạt, `total`, `nextCursor`.
3. `{"q":"đà lạt","postType":"video","limit":1}` → chỉ video; đi theo `nextCursor` tới khi `null`.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không. Chỉ sửa trong `discovery`. FE (Thành, Trang) chạy `pnpm gen:api` để có `searchPosts`.
