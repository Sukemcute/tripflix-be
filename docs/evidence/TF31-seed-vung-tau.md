# TF31 — Thêm khách sạn Vũng Tàu vào seed và điểm đến Vũng Tàu

- Task TF31 (bước B2 kế hoạch Tripi) · Nhánh: `bao/TF31-seed-vung-tau` · Người làm: Bảo (dùng AI: có) · Ngày: 2026-11-16

## Vì sao
Tripi cần gợi ý chỗ ở cho lộ trình mẫu Vũng Tàu 2N1Đ. Trước thay đổi này:
- Không tìm được "Vũng Tàu": điểm đến này không có trong `PLACES` của discovery. `/api/suggest?q=Vũng Tàu&types=place` không trả nơi nào, còn `/api/stays?placeId=vung-tau` trả 400 "Không có địa điểm này". Tripi phải hỏi lại người dùng.
- Seed có 14 khách sạn nằm trong TP Vũng Tàu (theo toạ độ), nhưng chỉ 2 khách sạn ghi `city` là Vũng Tàu, 12 khách sạn bị ghi nhầm `city: "Long Hải"`. Cả 14 đều có `provinceSlug: ho-chi-minh`, nên chỉ hiện khi tìm cả TP.HCM.

## Đã làm
1. **discovery** (`search/domain/places.ts`): thêm `destination('vung-tau', 'Vũng Tàu', 'ho-chi-minh', ['vt', 'vungtau'])`, cùng kiểu với Sài Gòn và Côn Đảo. Tìm TP.HCM vẫn gồm cả Vũng Tàu. Sửa thêm bình luận `place-of-post.ts` (Vũng Tàu giờ đã có trong PLACES) và thêm assert vào `stays.spec.ts`.
2. **commerce seed, 14 khách sạn có sẵn** (`P-osm-ho-chi-minh-003, 018, 026–029, 033, 034, 038, 040–042, 059, 067`): đổi `provinceSlug` sang `vung-tau`, `provinceName`/`city` sang `Vũng Tàu`, sửa "Long Hải"/"Vung Tau" trong địa chỉ và mô tả. Id, slug, giá, phòng, ảnh giữ nguyên, đơn cũ không ảnh hưởng. Bảo đã đồng ý trong phiên làm việc.
3. **commerce seed, 14 chỗ ở mới** `P-osm-vung-tau-001…014`: Imperial Hotel, Pacific Hotel Vung Tau, Mường Thanh Hotel, Annata Beach Hotel, Lan Rung Spa & Resort, The Coast Hotel, Sea View Residence, Petro Hotel, Diamond Star Hotel, Mepros hotel, Rie Homestay Vũng Tàu, Suna's HOME, An Homestay Vũng Tàu, Gecko Hostel.
   - **Nguồn OSM:** tên, toạ độ, địa chỉ lấy từ OpenStreetMap qua Overpass (© OpenStreetMap contributors, ODbL). Mã OSM ghi trong `osm-hotel-sources.json`. Mọi chỗ ở đều có thật trên OSM, không có chỗ nào bịa.
   - **Địa điểm gần đó (`details.nearby`):** 4 điểm tham quan, bãi biển, chợ gần nhất, tính bằng khoảng cách haversine từ toạ độ OSM của các điểm đó, xếp tăng dần.
   - **Sao, kiểu, giá, loại phòng, tồn kho, tiện ích, chính sách:** OSM không có sao, nên đây là dữ liệu mô phỏng giống các khách sạn OSM khác. Mỗi khách sạn mới lấy khuôn từ một khách sạn OSM có sẵn cùng `style` và cùng hạng sao, mỗi khuôn chỉ dùng một lần (ưu tiên khuôn ở TP.HCM). Lịch phòng do seed tự sinh từ `defaultTotal` như mọi khách sạn khác.
   - **Ảnh:** dùng thẳng URL `upload.wikimedia.org` (thumbnail 1280px), không tải về và không đưa lên S3, theo chọn lựa của Bảo. Mỗi khách sạn có 5 ảnh, mỗi loại phòng 1 ảnh riêng, không ảnh nào trùng với ảnh đã dùng. Chỉ lấy ảnh có giấy phép CC0, PD, CC BY hoặc CC BY-SA. Tên file, trang nguồn, tác giả, giấy phép ghi trong `osm-image-credits.json`, khoá là URL. Core trả nguyên URL `https` (`buildMediaUrl`). Web hiện ảnh từ host lạ ở dạng chưa tối ưu (`remote-images.ts`), nên không cần sửa FE.
   - Script sinh dữ liệu không commit, giống bộ sinh cũ của danh mục OSM. Bản script để trong thư mục ghi chú của phiên làm việc (`gen.py`, `wm.py`, `filt.py`).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Thêm 10–20 khách sạn, resort, homestay Vũng Tàu đúng định dạng và nguồn OSM | Có (14 mới) | `catalog-data.spec.ts` 14/14 pass: toạ độ trong VN, nearby tăng dần, 5 ảnh khác nhau, phòng có 1–3 ảnh, không dùng lại ảnh, ảnh có nguồn và giấy phép, phòng hướng biển chỉ ở khách sạn biển hoặc resort |
| Số khách sạn Vũng Tàu trước/sau | Có | Trước: 2 ghi `city` Vũng Tàu, 14 nằm trong TP theo toạ độ, 0 tìm được theo điểm đến. Sau: 28 có `provinceSlug: vung-tau` |
| `/api/stays` cho Vũng Tàu thấy nhiều khách sạn còn phòng | Có | Stack local: `/api/stays?placeId=vung-tau&checkIn=2026-12-05&checkOut=2026-12-06&adults=2` → `total: 28` (giá 320.000–7.690.000đ/đêm, 1–5 sao) |
| Không sửa migration, không đổi schema, không format lại file khác | Có | Diff chỉ có 3 file seed JSON và 3 file discovery. JSON giữ nguyên định dạng (indent 1, LF, không có newline cuối) |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected --continue --concurrency=2`: 49/49 task pass. core-api 2.562 test pass, 4 skip.
  - Lần chạy đầu, lúc Docker đang dựng lại stack, `libs/idempotency` hết giờ ở `beforeAll` vì Postgres chưa lên. Chạy lại khi stack đã lên thì pass 9/9.
- `catalog-data.spec.ts`: 14/14 pass. `stays.spec.ts` + `place-of-post.spec.ts`: 13/13 pass.
- Seed trên stack local (`pnpm stack:be`, container `migrate`): `commerce: 2214 khách sạn, 5168 loại phòng, 313 hạng ghế; mở thêm 5940 ngày phòng`.
- `/api/suggest?q=Vũng Tàu&types=place` và `q=vung tau` → `[place vung-tau "Vũng Tàu"]`.
- `/api/stays?placeId=vung-tau…` → 28 khách sạn, `nextCursor: null`. `placeId=ho-chi-minh` → 192 (gồm cả Vũng Tàu).
- `/api/hotels/P-osm-vung-tau-001` trả `thumbnail` là URL Wikimedia, `nearby` đúng thứ tự.
- Ảnh: trình duyệt tải 89/89 URL Wikimedia của 14 khách sạn mới (thẻ `<img>`, lấy URL từ `/api/hotels/:id`), không lỗi. Khi kiểm bằng script HEAD dồn dập thì Wikimedia trả 429 (chặn bot), không có URL nào 404.

## Cách kiểm lại
1. `pnpm stack:be`, chờ container `migrate` seed xong.
2. `curl "http://localhost:3000/api/suggest?q=vung%20tau&types=place"` → có `refId: vung-tau`.
3. `curl "http://localhost:3000/api/stays?placeId=vung-tau&checkIn=<ngày tới>&checkOut=<ngày sau>&adults=2&limit=50"` → `total` khoảng 28.
4. `pnpm --filter @tripflix/core-api exec vitest run src/modules/commerce/db/seed/catalog-data.spec.ts src/modules/discovery/search/domain/stays.spec.ts`.

## Ảnh / video
- Không đổi giao diện. Ảnh khách sạn mới lấy từ Wikimedia Commons, xem `osm-image-credits.json`.

## Ảnh hưởng tới phần của người khác
- ⚠️ **Có, seed commerce của Thắng** (`catalog.json`, `osm-hotel-sources.json`, `osm-image-credits.json`): thêm 14 khách sạn, đổi điểm đến, city, địa chỉ, mô tả của 14 khách sạn có sẵn. 14 khách sạn này không còn nằm trực tiếp dưới `ho-chi-minh`, nhưng vẫn hiện khi tìm TP.HCM vì Vũng Tàu là điểm đến con. Chờ Thắng duyệt rồi mới merge.
- ⚠️ **Có, discovery của Duy** (`places.ts` thêm 1 dòng, `stays.spec.ts` thêm assert, `place-of-post.ts` sửa bình luận): bài đăng nhắc "Vũng Tàu" giờ ra `placeId: vung-tau` thay vì `null`. Báo Duy trong PR.
- Ảnh dùng URL Wikimedia, nên phụ thuộc Wikimedia còn phục vụ file. Nếu muốn ảnh trên CDN như khách sạn khác thì cần tải về và chạy `upload-hotel-images` (việc sau).
