# TF28 — Một nguồn địa điểm duy nhất cho discovery (tìm + gợi ý)

- Jira: TF28 · Nhánh: `duy/TF28-mot-nguon-dia-diem` (tách từ PR #305 `duy/TF28-dang-di-van-goi-y-noi-moi`, **phụ thuộc PR #305**) · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-20

## Đã làm

1. **Gom toàn bộ địa điểm, bí danh và điểm đến sau sáp nhập 2025 về `PLACES`** (`search/domain/places.ts`, `place-seeds.ts`, `suggest-entity.ts`):
   - Giữ đủ 34 tỉnh/thành sau sáp nhập 2025 và 12 điểm đến cũ; bổ sung 13 điểm đến có trong dữ liệu bài viết / tag (`Mũi Né / Phan Thiết` → `lam-dong`, `Cát Bà` → `hai-phong`, `Mộc Châu` → `son-la`, `Mù Cang Chải` → `lao-cai`, `Bà Nà` → `da-nang`, `Buôn Ma Thuột` → `dak-lak`, `Pleiku` → `gia-lai`, `Biên Hòa` → `dong-nai`, `Cửa Lò / TP Vinh` → `nghe-an`, `Cam Ranh / Bình Ba` → `khanh-hoa`, `Phú Yên / Tuy Hòa` → `dak-lak`, `Hòn Sơn` → `an-giang`, `Kon Tum` → `quang-ngai`).
   - Tự sinh biến thể bỏ dấu (`ha giang`) và bỏ dấu viết liền (`hagiang`) qua `placeVariants` dùng `normalizeText`.
   - Tách viết tắt ngắn dễ trùng (`hn`, `sg`, `dn`, `ct`, `vt`, `nt`, `dl`, `hp`, `pq`, `qn`) vào `queryOnly`: vẫn dùng cho câu tìm, suggest, `placeIdOfName` và DB `places.aliases`, nhưng **không** đoán tỉnh từ hai chữ cái trong văn bản bài viết.
   - Tách địa danh/thắng cảnh (`ho guom`, `royal city`, `cau rong`, `landmark 81`, `dong khoi`, `ba na hills`, `cau vang`, `eo gio`, `ky co`, `lan ha`, `dray nur`, `doi cat`, `hang mua`, `song huong`, `my khe`, `xu nghe`) vào `landmarks`: nhận ra trong bài viết và hashtag của `recommend`, không sinh dòng `'place'` của `LEX` tìm khám phá để giữ nguyên tên địa danh trong `u.names` / `u.terms` (ví dụ `"vincom đồng khởi"`, `"cà phê hồ gươm"`).
   - Đặt `exploreBucket: 'Sài Gòn'` cho `ho-chi-minh` để tìm `"hcm"` / `"tp hcm"` và `"sài gòn"` giữ chung một nhóm trên tìm khám phá.
   - Chủ động **không** thêm từ đơn `'vinh'` vì sau bỏ dấu trùng `'vịnh'` (`"vịnh Lan Hạ"`, `"view vịnh"`) và làm `placeFix` sửa nhầm `'vin'` trong `'vin com'` thành `'vinh'` (thay bằng `'tp vinh'`, `'thanh pho vinh'`, `'cua lo'`).

2. **Một hàm tra nơi chung `placesIn` và bỏ hai danh sách trùng lặp** (`places.ts`, `lexicon.ts`, `lexicon-rows.ts`, `text.ts`, `explore.use-cases.ts`, `place-of-post.ts`, `bins.ts`, `topics.ts`, `build-features.use-cases.ts`):
   - Viết `placesIn(text, { isQuery })` so trên ranh giới từ sau chuẩn hoá, ưu tiên cụm dài nhất, trả danh sách id theo thứ tự xuất hiện; thêm `mostSpecificPlace` ưu tiên điểm đến con khi tỉnh và điểm đến con cùng xuất hiện.
   - `explorePlaceRows()` sinh dòng `'place'` của `LEX` trực tiếp từ `PLACES` trong `lexicon.ts`; xoá 50 dòng `["place", ...]` viết tay khỏi `lexicon-rows.ts`.
   - `destOf` và `placeIdOfName` giữ nguyên chữ ký, chuyển sang dùng `placesIn` / `mostSpecificPlace`.
   - `hotelToObject` (`explore.use-cases.ts`) chọn điểm đến `city` chỉ khi thuộc đúng tỉnh `province` của khách sạn, tránh việc thêm 34 tỉnh vào `PLACES` làm mất điểm đến con (`Lâm Đồng + Đà Lạt`) hoặc bị `city` nhiễu (khách sạn Bắc Ninh ghi `city: Hà Nội`) kéo sai tỉnh.
   - Hợp nhất `placeIdOfPost` (`place-of-post.ts`) và `placeOf` (`bins.ts`) qua `resolvePostPlace` theo cùng thứ tự nguồn: khách sạn → `placeId` có sẵn → tag → `destinationName` → `title` → `body` → `trip.items`; xoá `TAG_PLACES` khỏi `topics.ts`.

3. **Chốt chặn, log và bộ đo** (`places.spec.ts`, `build-features.use-cases.ts`, `recommend/eval/`):
   - `places.spec.ts` (26 test): kiểm tính duy nhất id, đủ 34 tỉnh, `parentId` trỏ đúng tỉnh, không trùng bí danh giữa hai nơi, mọi bucket `LEX` trỏ về `PLACES`, tự tra từ tên / bỏ dấu / viết liền, cách ly `queryOnly`, không bắt nhầm `"vịnh"`, bảng 14 tiêu đề từng mất nơi ở mục 1 ra đúng id và 6 tiêu đề không nói nơi ra `[]`.
   - `build-features.use-cases.ts`: log `recommend.place_unresolved_ratio` (`{ total, unresolved, ratio }`) cuối mỗi lượt build, không ghi tiêu đề bài.
   - `recommend/eval/`: thêm `unresolvedPlacePosts` (tính lại nơi từ dữ liệu thô, bỏ qua `placeId` dump cũ, đối chiếu khớp với `bins`) vào `formatBinStats` và assert `= []` trong `recommend-eval.spec.ts`; cập nhật `report.md`.

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Các tiêu đề ở mục 1 đều có `place_id` đúng | Đạt ở unit test + eval (SQL local chờ Duy chạy lại stack) | `places.spec.ts` (14/14 tiêu đề pass, 6 tiêu đề không nơi = `[]`), `recommend-eval.spec.ts` (`bài có nhắc nơi mà mất nơi: 0` trên `posts-2026-11-18.json`). Bước chạy lại Docker `core-api` local + SQL mục 1 để cho Duy chạy cùng `MODERATION_SERVICE_CLIENT_SECRET` (tránh ghi đè container đang bật AI). |
| Tìm `"cần thơ"`, `"mũi né"`, `"cát bà"`, `"hà giang"` có `placeIds` đúng | Có | `search-events.publisher.spec.ts`: `['can-tho']`, `['mui-ne']`, `['cat-ba']`, `['ha-giang']`. |
| Tìm khám phá không tụt | Có | `vitest run src/modules/discovery/search`: 16 file pass, 2 skip (147 test pass, 4 skip) gồm `explore.spec.ts`, `typo-regression.spec.ts`; `typo-bench.spec.ts` trước/sau ở bảng dưới (`*/typo` cold 86.7% → 88.1%, seed 80.9% → 84.1%). |
| Gợi ý không tụt | Có | `vitest run src/modules/discovery/recommend`: 26 file pass (240 test pass); `report.md` cập nhật: `bài có nhắc nơi mà mất nơi: 0`, `đúng nơi@10` mọi persona giữ nguyên ≥ trước. |
| Không còn danh sách nơi thứ hai | Có | `Select-String -Pattern 'TAG_PLACES\|\["place"'` trên `src/modules/discovery`: `0` kết quả. |
| Lint, typecheck, test | Đạt ở `@tripflix/core-api` | `core-api` lint 0 error, typecheck pass; 6 file e2e/seed ngoài `discovery` quá giờ 5000ms khi chạy song song toàn suite đã chạy lại riêng pass 6/6 (55/55 test). `turbo --affected` chỉ fail sẵn ở `@tripflix/notification-service#typecheck` do `node_modules` local chưa cài `web-push` sau PR #303/#304. |

## Kết quả kiểm tra

### `typo-bench` (`SEARCH_BENCH=1`, trước / sau)

| Bộ | Nhóm | Trước (`n` / recall chính % / có sửa %) | Sau (`n` / recall chính % / có sửa %) |
|---|---|---|---|
| cold (230 mục) | `*/clean` | 280 / 98.6% / 1.4% | 442 / 98.2% / 0.9% |
| cold (230 mục) | `*/typo` | 1582 / 86.7% / 76.5% | 2419 / 88.1% / 83.8% |
| cold (230 mục) | `place/clean` | 36 / 100% / 0% | 117 / 100% / 0% |
| cold (230 mục) | `place/drop1` | 55 / 96.4% / 92.7% | 189 / 94.2% / 93.1% |
| cold (230 mục) | `place/drop2` | 37 / 37.8% / 37.8% | 145 / 49% / 64.8% |
| cold (230 mục) | `place/dropFirst` | 30 / 93.3% / 73.3% | 91 / 96.7% / 85.7% |
| cold (230 mục) | `dayPairBench top1Days` | 40 cặp / 90% | 40 cặp / 90% |
| seed (2224 mục) | `*/clean` | 262 / 98.5% / 0% | 468 / 97.9% / 0% |
| seed (2224 mục) | `*/typo` | 1348 / 80.9% / 76% | 2353 / 84.1% / 84.7% |
| seed (2224 mục) | `place/clean` | 39 / 100% / 0% | 142 / 100% / 0% |
| seed (2224 mục) | `place/drop1` | 51 / 82.4% / 78.4% | 207 / 89.4% / 87.4% |
| seed (2224 mục) | `place/drop2` | 34 / 26.5% / 50% | 156 / 42.9% / 57.7% |
| seed (2224 mục) | `place/dropFirst` | 30 / 80% / 66.7% | 107 / 85% / 78.5% |
| seed (2224 mục) | `dayPairBench top1Days` | 40 cặp / 90% | 40 cặp / 90% |

### `recommend/eval/report.md`
- Ngăn của bài: `243 bài: 243 có nơi, 0 không có nơi; bài có nhắc nơi mà mất nơi: 0; 30 không có ngăn trải nghiệm nào.`
- `đúng nơi@10` trên cả v0 và v1 không đổi (`ca-that-18-11`: `0,70`; `kh-dalat-sang-nhatrang`: `0,70` / `0,40`; `kh-moi-phuquoc`: `0,20` / `0,40`; `sap-di-nhatrang`: `0,70` / `0,40`; `dang-di-dalat`: `0,60` / `0,40`; `kh-bam-dat-reels-danang`: `0,10` / `0,40`), `nơi vừa đi@10` = `0`, `KS khác@10` = `0`.

### Lệnh kiểm tra đã chạy (trong `tripflix-be`)
- `pnpm --filter core-api exec vitest run src/modules/discovery/search`: **16 passed, 2 skipped** (`explore.parity`, `typo-bench`); **147 tests passed, 4 skipped**.
- `pnpm --filter core-api exec vitest run src/modules/discovery/recommend`: **26 passed (240 tests passed)**.
- `$env:SEARCH_BENCH='1'; pnpm --filter core-api exec vitest run src/modules/discovery/search/eval/typo-bench.spec.ts`: **2 passed, 1 skipped (warm prototype)** (`cold` 7.38s, `seed` 24.45s).
- `Get-ChildItem -Path apps\core-api\src\modules\discovery -Recurse -File | Select-String -Pattern 'TAG_PLACES|\["place"'`: **0 kết quả**.
- `pnpm --filter @tripflix/core-api exec oxlint --type-aware src/modules/discovery`: **0 errors**, 1 warning có sẵn (`jobs/job-runs.ts:109`).
- `pnpm --filter @tripflix/core-api lint`: **0 errors**, 128 warnings có sẵn ở module khác.
- `pnpm --filter @tripflix/core-api typecheck`: pass (exit 0).
- `pnpm --filter @tripflix/core-api test`: 172 passed, 2 skipped, 6 file ngoài `discovery` quá giờ 5000ms khi chạy song song (`service-token.e2e.spec.ts`, `moderation.e2e.spec.ts`, `auth.e2e.spec.ts`, `staff.e2e.spec.ts`, `post-summary.e2e.spec.ts`, `generate-reels.spec.ts`). Chạy lại riêng 6 file với `--fileParallelism=false`: **6/6 files passed (55/55 tests passed)**.
- `pnpm turbo run lint typecheck test --affected`: 44/49 task pass, fail duy nhất ở `@tripflix/notification-service#typecheck` (`Cannot find module 'web-push'`, lỗi thiếu `pnpm install` local sau PR #303/#304, không liên quan `discovery`).

## Cách kiểm lại

1. Chạy bộ kiểm tra unit + eval của discovery trong `tripflix-be`:
   ```powershell
   pnpm --filter core-api exec vitest run src/modules/discovery/search src/modules/discovery/recommend
   ```
2. Thử trên stack local (cần biến `MODERATION_SERVICE_CLIENT_SECRET`, hoặc bỏ `-f ../tools/compose.ai-local.yaml --profile ai` nếu không cần embed):
   ```powershell
   docker compose -f deploy/compose.yaml -f ../tools/compose.ai-local.yaml --profile be --profile fe --profile gateway --profile ai up -d --build --no-deps core-api
   ```
3. Sau khi job dựng đặc trưng khởi động xong, kiểm tra SQL trên Postgres local (chỉ còn 6 tiêu đề thật sự không nói nơi):
   ```sql
   select left(p.title,45) t, count(*) from content.posts p
   join discovery.recommend_posts r on r.post_id = p.id
   where r.place_id is null group by 1 order by 2 desc;
   ```
4. Đăng nhập `member@tripflix.local` (`tripflix-dev-123`), tìm `"cần thơ"`, thả tim 2 bài Cần Thơ, mở `GET /api/recommendations/posts?mode=for_you&postType=vlog` kiểm tra có bài `"Vì bạn đang tìm hiểu Cần Thơ"`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không sửa file nào ngoài `apps/core-api/src/modules/discovery/`.
- Không sửa API, sự kiện hay schema DB; `LoadPlacesJob` tự nạp thêm 13 điểm đến và bí danh vào `discovery.places` khi worker khởi động.
