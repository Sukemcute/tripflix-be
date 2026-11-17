# TF67 — Discovery trả slug khách sạn trong kết quả search, explore, stays, suggest

- Jira: [SCRUM-71](https://tripflix.atlassian.net/browse/SCRUM-71) · Nhánh: `duy/TF67-slug-khach-san-discovery` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- `POST /api/search`, `/api/search/posts`, `/api/search/places`: mỗi mục có thêm `slug` (`string | null`). Khách sạn lấy slug từ `CommerceFacade.listCatalog` (cột `slug` của TF66) lúc dựng chỉ mục, rồi lưu trong `doc` jsonb của `search_documents`, nên không cần migration. Mục khác là `null`.
- `GET /api/stays`: có thêm `slug` cạnh `hotelId`.
- `GET /api/suggest`: dòng `hotel` có thêm `slug`; dòng `place`, `airport` là `null`. Thêm cột `slug` (cho phép null) vào `discovery.search_entities`, migration `20261117095748_smooth_mulholland_black` (chỉ `ADD COLUMN`). Ticket chỉ ghi ba endpoint, nhưng web dựng link khách sạn ở ô tìm OTA (`live-search-screen.tsx`) từ kết quả suggest, nên làm luôn để đủ mọi luồng.
- Chỉ **thêm** field, không đổi field cũ. `refId` / `hotelId` vẫn giữ nguyên, `/hotels/<id>` vẫn chạy (TF66).
- Đã sinh lại `contracts/openapi/core-api.json`.
- Sau khi deploy, slug có giá trị khi job dựng lại chỉ mục (explore và suggest) chạy lượt kế tiếp. Trước đó trả `null`, FE dùng `slug ?? refId`.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Jira) | Đạt | Bằng chứng |
|---|---|---|
| Kết quả search, explore, stays có mục khách sạn trả thêm `slug` cạnh `refId` | Đạt | `explore.use-cases.spec.ts` (mục `hotel:H1` có slug, bài có `slug: null`), `stays.use-cases.spec.ts` "TF67: trả slug khách sạn từ commerce…" |
| Lấy qua facade của `commerce`, không query thẳng bảng | Đạt | Slug đi từ `CatalogHotel.slug` của `CommerceFacade.listCatalog` (`discovery.module.ts`, `stays.use-cases.ts`) |
| Cập nhật `contracts/openapi`, `docs/api-search.md` | Đạt | `contracts/openapi/core-api.json` (ExploreItemDto, StayDto, SuggestionDto); `docs/api-search.md` ở workspace root, mục 3.3 |
| Thêm: suggest trả slug khách sạn | Đạt | `suggest-entity.spec.ts` "TF67: khách sạn mang slug của commerce…" |

## Kết quả kiểm tra
- `pnpm typecheck` (core-api): 0 lỗi.
- `oxlint --type-aware --threads=2 src` (core-api): exit 0. Chỉ có cảnh báo `unbound-method` sẵn có trong `content/social`, không thuộc task. Chạy mặc định (không `--threads`) thì tsgolint hết RAM trên máy local.
- `vitest run --maxWorkers=2` (core-api): 139 file pass, 2 skip; 2700 test pass, 4 skip. Discovery riêng: 242 pass, 4 skip.

## Cách kiểm lại
1. `pnpm stack:up`, chạy migration discovery, đợi job dựng lại chỉ mục (hoặc gọi job dựng lại).
2. `POST /api/search` với `{"q":"khách sạn đà lạt"}`: mục `kind: "stay"` có `slug`, mở `GET /api/hotels/<slug>` ra 200.
3. `GET /api/stays?placeId=lam-dong&checkIn=…&checkOut=…&adults=2`: mỗi mục có `slug`.
4. `GET /api/suggest?q=ana mandara`: dòng `hotel` có `slug`, dòng `place` là `null`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không sửa code của người khác. Chỉ đọc thêm field `slug` có sẵn trên `CatalogHotel` (commerce, Thắng).
- FE (Thành): có thể đổi link khách sạn sang `slug ?? refId` / `slug ?? hotelId` sau khi `pnpm gen:api`. Đây là việc của TF66, không thuộc TF67.
