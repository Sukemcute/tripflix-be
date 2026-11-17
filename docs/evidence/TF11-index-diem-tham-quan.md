# TF11 — Đưa quán ăn, cà phê, điểm tham quan vào tìm khám phá

- Notion: — · Nhánh: `duy/TF11-index-diem-tham-quan` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- `rebuildIndex()` nạp thêm 630 điểm OSM của `/api/places` (TF31, Bảo) vào chỉ mục tìm khám phá. Engine đã có sẵn nhánh `eats` (food, cafe) và `sights` (see) nhưng chưa có dữ liệu. Chỗ ở OSM (`lodging`) bị bỏ để không lẫn với khách sạn đặt được.
- Tag OSM tiếng Anh được kèm chữ tiếng Việt (`museum` → "bảo tàng", `beach` → "biển bãi biển"...) để câu tiếng Việt khớp.
- Điểm OSM đi vào qua token `EXPLORE_POINTS` (thật: `POINTS_OF_INTEREST`), nên test truyền dữ liệu riêng được.
- Script `fetch-osm-places.mjs`: so tên đã bỏ dấu, hoa thường, số khi lọc trùng ("An Lạc Tâm" / "An lac tam" / "An Lac Tam 3" chỉ còn một). Quán cùng điểm phổ biến được xếp theo khoảng cách tới trung tâm thay vì theo tên. Đã sinh lại dữ liệu, vẫn 630 điểm, 90 điểm mỗi thành phố.
- Không đổi API: `ExploreItemDto.kind` vốn đã ghi `food, cafe, see khi có nguồn dữ liệu`. `/api/places` giữ nguyên hợp đồng.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Tìm "cà phê đà lạt" ra quán cà phê thật | Có | `explore.use-cases.spec.ts` › điểm OSM trong chỉ mục; chạy thử dữ liệu thật bên dưới |
| Không trộn chỗ ở ngoài Tripflix vào nhánh khách sạn | Có | test `map quán... bỏ chỗ ở ngoài Tripflix` |
| Dữ liệu không còn quán trùng chuỗi | Có | sinh lại `points-of-interest.data.ts` |

## Kết quả kiểm tra
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
