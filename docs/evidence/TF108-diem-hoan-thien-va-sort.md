# TF108 — Điểm hoàn thiện bài viết + chọn kiểu gợi ý / sắp xếp (Task A–C)

- Notion / Jira: TF108 · Nhánh: `duy/TF108-diem-hoan-thien-va-sort` · Người làm: duy (dùng AI: có) · Ngày: 2026-11-18

## Đã làm
- **Task A (Điểm hoàn thiện + builder `hot@v2`)**:
  - Tạo `recommend/domain/completeness.ts` (`COMPLETENESS_WEIGHTS`, `hasPlan()`, `calculateCompleteness()`).
  - Mở rộng `RecommendSourcePost`, `PostBuildItem`, `PostMeta`/`RecommendPostRow`, cập nhật `BuildFeaturesUseCases.build()` và `DrizzleRecommendStore.replacePosts()`.
  - Thêm cột `has_plan` vào `discovery.recommend_posts` và tạo migration `20261117174406_orange_moira_mactaggert` (kèm cập nhật `recommend_algos` cho `trending`, `for_you` sang `hot@v2`).
  - Thêm `hot@v2` (`HotV2FeaturesSchema`, `raw_v2 = raw_v1 × (0.5 + 0.5 × completeness)`), tách phần chung với `hot@v1` không đổi kết quả v1, đăng ký vào `BUILDERS` và `rankers`.
- **Task B (Mode `has_plan` & `recent` cho `/recommendations/posts` và `/reels`)**:
  - Mở rộng `mode` thêm `'has_plan'` và `'recent'` trên `PostRecommendationQuerySchema`, `ReelRecommendationQuerySchema`, `RecommendReasonDto` (`recent`), cập nhật `CandidateQuery.hasPlan` và `DrizzleRecommendStore.candidates()`.
  - `has_plan` dùng lại luồng `for_you` (khách dùng `trending`) với lọc `has_plan = true` ở tất cả nguồn ứng viên.
  - `recent` đọc từ `recommend_posts` theo `publishedAt desc, postId desc` (cửa sổ 30 ngày), không qua ranker/explore/phạt lịch sử, giữ bài tự đăng trong 1h lên đầu.
  - Cập nhật cursor (`mode`) và chạy `pnpm contracts:build`.
- **Task C (Sort & điểm hoàn thiện trong `POST /api/search/posts`)**:
  - Thêm `sort: 'relevance' | 'trending' | 'recent'` vào `SearchPostsRequestSchema`/`Dto` và `ExploreUseCases.searchPosts` (sắp xếp `shown` trước `paginate`, đọc điểm `hot@v2` qua `RecommendStore.findPostScores` với fallback warn giữ `relevance` khi lỗi).
  - Bổ sung `completeness` vào `ExplorePost`, `ExploreObject` (`postToObject`), và công thức `quality` trong `rank.ts` (`0.7 × cũ + 0.3 × completeness` khi có số).
  - Chạy `pnpm contracts:build`.

- **Sửa sau review (18/11)**:
  - `findPostMetas()` trả thêm `hasPlan`: thiếu cột này thì mode `has_plan` loại mọi bài tự đăng. Test: `post-recommendations.use-cases.spec.ts` (bài tự đăng có/không lịch trình), `drizzle-recommend.store.int.spec.ts`.
  - `build-features.use-cases.int.spec.ts` kiểm `hot@v2` thay vì `hot@v1` (migration đã chuyển thuật toán sang `hot@v2`).
  - Điểm lịch trình chấm theo mức đầy đủ thay vì có/không: `0,3 × (0,6 × độ phủ ngày + 0,4 × tỉ lệ mục có nơi)`; độ phủ ngày = số ngày 1..`daysCount` có mục ÷ `daysCount` (thiếu thì lấy ngày lớn nhất). Thông tin chuyến chia đều điểm đến / số ngày / chi phí (mỗi thứ 0,05). `hasPlan` cần ít nhất một mục lịch trình (chỉ ghi số ngày không tính). Mọi phần là tỉ lệ nên không ưu tiên chuyến dài hơn. Test: `completeness.spec.ts`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| A: Test `completeness`, `hot@v2`, `hot-v1.spec.ts` giữ nguyên, `*.int.spec.ts` cập nhật `has_plan` | Đạt | `completeness.spec.ts` (4/4), `hot-v2.spec.ts` (2/2), `hot-v1.spec.ts` (5/5), `build-features.use-cases.spec.ts` (4/4) |
| B: Test `has_plan`, `recent`, phân trang, khách gọi `has_plan`, mode cũ giữ nguyên | Đạt | `post-recommendations.use-cases.spec.ts` (24/24) |
| C: Test `searchPosts` 3 kiểu `sort`, lỗi đọc điểm, `quality` có/không `completeness` | Đạt | `explore.use-cases.spec.ts` (19/19), `explore.spec.ts` (22/22) |
| Bảng đo trước/sau 6 câu `posts` (`queries.json`) trên local stack | Đạt | Bảng bên dưới |
| `lint`, `typecheck`, `test` pass hết | Đạt | Mục "Kết quả kiểm tra" |

## Đo trước/sau Task C (`POST /api/search/posts`, 6 câu `posts` trong `search/eval/queries.json`)

- **Test search trước C2**: `15 passed | 2 skipped (17)` files, `116 passed | 4 skipped (120)` tests (`explore.parity.spec.ts` và `typo-bench.spec.ts` skip sẵn theo cấu hình repo).
- **Test search sau C2**: `15 passed | 2 skipped (17)` files, `118 passed | 4 skipped (122)` tests (thêm 2 test mới cho `sort` và `completeness`).

| ID | Câu tìm | Trước (top-3) | Sau (top-3) |
|---|---|---|---|
| Q06 | `review quán ăn ngon ở Hội An` | 1. `Quán Hội An 2N1Đ: check-in phố cổ + mì Quảng ở Sài Gòn ngon xỉu, cuối tuần ghé lại` (total: 1) | 1. `Quán Hội An 2N1Đ: check-in phố cổ + mì Quảng ở Sài Gòn ngon xỉu, cuối tuần ghé lại` (total: 1) |
| Q08 | `kinh nghiệm đi Côn Đảo lần đầu` | 1. `Bình Ba Cam Ranh: tôm hùm và lặn ngắm san hô` (fallback, total: 1) | 1. `Bình Ba Cam Ranh: tôm hùm và lặn ngắm san hô` (fallback, total: 1) |
| Q18 | `an gi o hue` | 1. `Huế 2N1Đ: Đại Nội, chùa Thiên Mụ, bún bò` · 2. `Quán Huenino Hotel ở Huế ngon xỉu, cuối tuần ghé lại` · 3. `Ngày 2 ở Huế: checkin cả ngày` (total: 14) | 1. `Huế 2N1Đ: Đại Nội, chùa Thiên Mụ, bún bò` · 2. `Quán Huenino Hotel ở Huế ngon xỉu, cuối tuần ghé lại` · 3. `Ngày 2 ở Huế: checkin cả ngày` (total: 14) |
| Q24 | `sống ảo ở đâu đẹp 📸` | 1. `Ngày 3 ở Sài Gòn: nightlife cả ngày` · 2. `Ngày 1 ở Sài Gòn: streetfood cả ngày` · 3. `Quán Hội An 2N1Đ: check-in phố cổ + mì Quảng ở Sài Gòn ngon xỉu, cuối tuần ghé lại` (total: 6) | 1. `Ngày 3 ở Sài Gòn: nightlife cả ngày` · 2. `Ngày 1 ở Sài Gòn: streetfood cả ngày` · 3. `Quán Hội An 2N1Đ: check-in phố cổ + mì Quảng ở Sài Gòn ngon xỉu, cuối tuần ghé lại` (total: 6) |
| Q27 | `pq có beach club nào quẩy k` | 1. `Ngày 3 ở Phú Quốc: homestay cả ngày` · 2. `Ngày 1 ở Phú Quốc: giadinh cả ngày` (total: 2) | 1. `Ngày 3 ở Phú Quốc: homestay cả ngày` · 2. `Ngày 1 ở Phú Quốc: giadinh cả ngày` (total: 2) |
| Q49 | `mua vé số ở đâu` | 1. `Tràng An mùa lúa chín` · 2. `Mùa lúa chín Mù Cang Chải` · 3. `Săn mây Đà Lạt 4h sáng và trải nghiệm nghỉ dưỡng tại Dalat Palace` (total: 147) | 1. `Tràng An mùa lúa chín` · 2. `Mùa lúa chín Mù Cang Chải` · 3. `Săn mây Đà Lạt 4h sáng và trải nghiệm nghỉ dưỡng tại Dalat Palace` (total: 147) |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck --affected --concurrency=2`: 36/36 tasks pass (0 errors).
- `node tools/check-boundaries.mjs`: `Ranh giới module: không có vi phạm.`
- `pnpm --filter @tripflix/core-api exec vitest run --maxWorkers=2`: `151 passed | 2 skipped (153)` files, `2782 passed | 4 skipped (2786)` tests. *(Chạy với `--maxWorkers=2` để tránh tràn bộ nhớ worker trên Windows).*

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected` (trên Windows thêm `--concurrency=2` nếu cần).
2. `pnpm db:migrate` và `pnpm stack:be` để kiểm tra migration và API `GET /api/recommendations/posts`, `GET /api/recommendations/reels`, `POST /api/search/posts`.

## Ảnh / video
- Không (task BE).

## Ảnh hưởng tới phần của người khác
- Không: mọi thay đổi nằm trong module `discovery` và file sinh tự động `contracts/openapi/core-api.json`.
