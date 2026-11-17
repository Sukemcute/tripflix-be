# TF11 — Địa điểm ngoài OTA: bảng, tìm khám phá, tab tìm theo loại

- Notion: — · Nhánh: `duy/TF11-index-diem-tham-quan` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- `rebuildIndex()` nạp thêm 630 điểm OSM của `/api/places` (TF31, Bảo) vào chỉ mục tìm khám phá. Engine đã có sẵn nhánh `eats` (food, cafe) và `sights` (see) nhưng chưa có dữ liệu. Chỗ ở OSM (`lodging`) bị bỏ để không lẫn với khách sạn đặt được.
- Tag OSM tiếng Anh được kèm chữ tiếng Việt (`museum` → "bảo tàng", `beach` → "biển bãi biển"...) để câu tiếng Việt khớp.
- Điểm OSM đi vào chỉ mục qua port `PlacesStore` (đợt 2: đọc bảng), nên test truyền dữ liệu riêng được.
- Script `fetch-osm-places.mjs`: so tên đã bỏ dấu, hoa thường, số khi lọc trùng ("An Lạc Tâm" / "An lac tam" / "An Lac Tam 3" chỉ còn một). Quán cùng điểm phổ biến được xếp theo khoảng cách tới trung tâm thay vì theo tên. Đã sinh lại dữ liệu, vẫn 630 điểm, 90 điểm mỗi thành phố.
- Không đổi API: `ExploreItemDto.kind` vốn đã ghi `food, cafe, see khi có nguồn dữ liệu`. `/api/places` giữ nguyên hợp đồng.

### Đợt 2 (cùng ngày): bảng dữ liệu và tab tìm theo loại (PRD 0.3.1)
- Bảng `discovery.places` (cây nơi: id trùng slug commerce, `aliases`, toạ độ tâm) và `discovery.points_of_interest` (id OSM, `kind`, `tags`, `popularity`, `details` jsonb, `source`, `is_hidden`). Migration `20261117084806_places_and_points_of_interest`.
- `LoadPlacesJob` nạp mỗi lần worker khởi động (`onModuleInit`, xong trước job dựng chỉ mục): upsert, giữ `is_hidden`, xoá điểm đã mất khỏi nguồn. Không đặt ở `db:seed` vì lệnh đó không chạy ở production.
- `/api/places` và chỉ mục tìm khám phá đọc bảng thay cho hằng. `/api/places` mở theo cây nơi: "Lâm Đồng" ra điểm của Đà Lạt; hợp đồng giữ nguyên (cả `operationId`).
- `POST /api/search/places` (`kind`: `stay`, `see`, `food`, `cafe`; phân trang; `attribution` khi có điểm OSM) cho các tab của grid tìm kiếm web.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Tìm "cà phê đà lạt" ra quán cà phê thật | Có | `explore.use-cases.spec.ts` › điểm OSM trong chỉ mục; chạy thử dữ liệu thật bên dưới |
| Không trộn chỗ ở ngoài Tripflix vào nhánh khách sạn | Có | test `map quán... bỏ chỗ ở ngoài Tripflix` |
| Dữ liệu không còn quán trùng chuỗi | Có | sinh lại `points-of-interest.data.ts` |
| "Lâm Đồng" ra điểm của Đà Lạt (`/api/places` theo cây nơi) | Có | `places.controller.spec.ts` › tỉnh gồm điểm của điểm đến con |
| Nạp lại giữ điểm admin đã ẩn, xoá điểm đã mất | Có | `drizzle-places.store.int.spec.ts` (Postgres thật, 2/2) |
| Tab tìm theo loại có phân trang, ghi nguồn OSM | Có | `explore.use-cases.spec.ts` › searchPlaces; `SearchPlacesRequestSchema` |

## Kết quả kiểm tra
- Đợt 2 (sau khi merge develop): `vitest run` core-api 2651 pass, 4 skip; int test store 2/2; typecheck pass; `oxlint src/modules/discovery` 0 lỗi. Chạy thật trong Docker: log "Đã nạp 43 nơi, 630 điểm OSM", chỉ mục 2982 mục; `POST /api/search/places` "cà phê đà lạt" ra 15 quán kèm `attribution`.
- `vitest run` toàn core-api (`--maxWorkers=2`): 2647 pass, 1 fail, 4 skip. Test fail là `access/account.e2e.spec.ts` bị timeout 5 s khi máy thiếu RAM; chạy riêng thì pass 8/8. Không liên quan thay đổi này.
- `typecheck`: pass.
- `oxlint src/modules/discovery`: 0 lỗi. `oxlint --type-aware src` không chạy được trên máy (tsgolint "out of memory", máy còn khoảng 1 GB RAM trống), để CI kiểm.
- Chạy thử engine với 630 điểm thật:
  - "cà phê đà lạt" → cafe 15: The Choco, Cà phê Dõc Ga, 1thev Coffee Đà lạt
  - "bảo tàng hà nội" → see 10: Bảo tàng Hà Nội, Bảo tàng Hồ Chí Minh, Bảo tàng Phụ nữ Việt Nam
  - "highlands coffee" → cafe: Highlands Ca Phe
  - "bien vung tau" → chỉ 1 bãi (Bãi Trước), vì dữ liệu chỉ lấy 40 điểm tham quan mỗi thành phố
  - "chùa ở huế" → trống, vì Huế chưa có trong 7 thành phố

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/discovery/search/application/explore.use-cases.spec.ts`
2. `pnpm stack:up`, đợi job dựng chỉ mục, rồi gọi `GET /api/explore?q=cà phê đà lạt`.

## Ảnh / video
- Không đổi giao diện. FE explore chưa được kiểm với section food, cafe, see.

## Ảnh hưởng tới phần của người khác
- `scripts/fetch-osm-places.mjs` và `points-of-interest.data.ts` do Bảo viết (TF31) nhưng nằm trong discovery. Id điểm vẫn là id OSM, `/api/places` giữ nguyên hợp đồng. Tập điểm trả về thay đổi vì đã lọc trùng và chọn lại quán. Cần báo Bảo.
- Bộ đánh giá `eval/queries.json` (v1, đã đóng băng) không có câu nào về quán, nên chưa đo. Muốn đo phải mở version 2.
