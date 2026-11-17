# TF31 — Điểm tham quan, ăn uống có toạ độ cho Tripi xếp lộ trình (`GET /api/places`)

- Notion: TF31 · Nhánh: `bao/TF31-diem-tham-quan` · Người làm: Bảo (dùng AI: có) · Ngày: 2026-11-17
- Kế hoạch: bước B1 (Giai đoạn B của Tripi). Bên dùng: AI nhánh `bao/TF31-cong-du-lieu` (`CorePlaces`).

## Đã làm
- **`GET /api/places`** (công khai, chỉ đọc):
  - Tham số: `city` hoặc `near=lat,lng`, cùng `kinds` (`see`, `food`, `cafe`, `lodging`), `radiusKm` (1–50, mặc định 15), `limit` (1–100, mặc định 40).
  - Trả `{ items: [{ id, name, kind, lat, lng, city, tags, popularity }], attribution }`.
  - Xếp theo độ phổ biến rồi khoảng cách. Thành phố chưa có dữ liệu thì trả `items: []`, không đoán.
  - `city` nhận tên có dấu hoặc không dấu, id (`vung-tau`) và tên gọi khác (`TP.HCM`, `Sài Gòn`, `HN`), vì trợ lý gửi đúng chữ người dùng nói.
  - `lodging` là chỗ ở ngoài Tripflix: chỉ tham khảo, không giá, không đặt.
- **Dữ liệu:** 630 điểm của 7 thành phố demo, mỗi nơi 90 điểm (Vũng Tàu, Đà Lạt, Đà Nẵng, Nha Trang, Phú Quốc, Hà Nội, TP.HCM).
  - Sinh bằng `apps/core-api/scripts/fetch-osm-places.mjs` từ Overpass API (OpenStreetMap).
  - Mỗi thành phố giới hạn: see 40, food 20, cafe 15, lodging 15.
  - Overpass hay quá tải (502, hoặc 200 kèm danh sách rỗng khi quá giờ): script thử lại tối đa 6 lần, đổi sang máy chủ dự phòng.
  - File `points-of-interest.data.ts` là file sinh: không sửa tay, chạy lại script để cập nhật.
- **Độ phổ biến:** OSM không có số đo này. Script dùng dấu hiệu có Wikidata, Wikipedia, website (0,4–1,0) **[HIỆU CHỈNH]**.
- **Ghi nguồn:** `© OpenStreetMap contributors (ODbL)` ở đầu file dữ liệu và trong mọi response (`attribution`).
- **Khác kế hoạch:** kế hoạch ghi bảng `discovery.places` có migration.
  - Em làm dữ liệu tĩnh trong bộ nhớ, giống `PLACES` và `AIRPORTS` đang có: 630 điểm khoảng 100 KB, không cần bảng hay migration.
  - Khi cần sửa trên admin hoặc thêm nhiều thành phố thì chuyển sang bảng (đã ghi `shortcut:` trong code).
- `pnpm contracts:build`: `contracts/openapi/core-api.json` chỉ thêm path `/api/places` và schema, không đổi gì có sẵn.

## Đối chiếu "Xong khi"
| Tiêu chí (kế hoạch B1) | Đạt | Bằng chứng |
|---|---|---|
| POI có id, tên, loại, toạ độ, thành phố, tags, độ phổ biến | Đạt | `PointOfInterestDto`; file dữ liệu 630 điểm |
| Nạp từ OSM, ghi nguồn ODbL | Đạt | `fetch-osm-places.mjs`; `attribution` trong response |
| `GET /api/places?city=&near=&kinds=&radiusKm=&limit=` công khai | Đạt | `places.controller.ts`, 6 test trong `places.controller.spec.ts` |
| Bảng + migration | **Không làm** | Dùng dữ liệu tĩnh, lý do ở trên |
| `pnpm contracts:build` | Đạt | `contracts/openapi/core-api.json` +152 dòng, 0 dòng xoá |
| Gọi thật trên stack local | **Chưa** | Docker trên máy tắt |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: **49/49** task thành công (2026-11-17).
  - core-api: 2.586 test pass, 4 skip (có sẵn từ trước); `places.controller.spec.ts` 6/6.
  - Lint: 0 lỗi; cảnh báo có sẵn từ trước.

## Cách kiểm lại
1. `pnpm stack:up`, rồi gọi `curl "http://localhost:8080/api/places?city=Vũng%20Tàu&kinds=see&limit=5"`.
   - Đúng: 5 điểm tham quan Vũng Tàu, có toạ độ và `attribution`.
2. `curl "http://localhost:8080/api/places?city=TP.HCM&kinds=food"`: ra quán ăn ở TP.HCM.
3. `curl "http://localhost:8080/api/places"`: 400 (thiếu cả `city` lẫn `near`).
4. Cập nhật dữ liệu: `node apps/core-api/scripts/fetch-osm-places.mjs` (mất vài phút vì Overpass công cộng).

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: module `discovery` (chủ: **Duy**).
  - Thêm `PlacesController` vào `discovery.module.ts` (2 dòng).
  - Thêm schema vào `search/api/dto.ts`, không sửa schema có sẵn.
  - Còn lại là file mới.
  - Cần Duy duyệt trước khi merge.
