# TF111 — Thêm tham số `fresh` cho gợi ý bài viết (`GET /api/recommendations/posts`)

- Task: TF111 · Nhánh: `duy/TF111-recommend-posts-fresh` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-25

## Đã làm

1. **Thêm tham số query `fresh` (`'true' | 'false'`, không bắt buộc) vào `GET /api/recommendations/posts`**:
   - File: `apps/core-api/src/modules/discovery/recommend/api/post-recommendations.controller.ts`
   - Thêm `fresh: z.enum(['true', 'false']).optional()` vào `PostRecommendationQuerySchema`, tài liệu `@ApiOperation` / `@ApiQuery`, và truyền `fresh: parsed.data.fresh === 'true'` vào `PostRecommendationUseCases.recommend(...)`.
   - `PostRecommendationUseCases.recommend` tái sử dụng trực tiếp logic `selectRankedPage` / `resolveSeenUntil` / `seenUntilField` giống `recommendReels`: trang đầu không có `cursor` với `fresh=true` đặt `seenUntil = now` để đẩy xuống mọi bài đã gợi ý (kể cả trong phiên 30 phút) và mang `seenUntil` qua `cursor` sang các trang sau; nếu truyền `cursor` hoặc là khách thì bỏ qua `fresh`.
2. **Sinh lại OpenAPI contract**:
   - Chạy `pnpm contracts:build`, cập nhật `contracts/openapi/core-api.json` với tham số query `fresh` cho `PostRecommendationsController_recommendPosts`.
3. **Bổ sung unit test**:
   - `apps/core-api/src/modules/discovery/recommend/api/post-recommendation-query.spec.ts` (2 tests): kiểm tra validation `'true'`, `'false'`, `undefined`, từ chối giá trị không hợp lệ.
   - `apps/core-api/src/modules/discovery/recommend/application/post-recommendations.use-cases.spec.ts`: thêm test kiểm tra `useCases.recommend` với `fresh: true` đẩy bài vừa gợi ý xuống trong cùng 30 phút, ghi `seenUntil` vào `nextCursor`, và bỏ qua `fresh` khi đã có `cursor`.

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| `GET /api/recommendations/posts` nhận `fresh=true \| false` giống `/reels` | Có | `PostRecommendationQuerySchema` + `post-recommendation-query.spec.ts` (2/2 pass) |
| Trang đầu `fresh=true` mở phiên mới đẩy bài vừa gợi ý xuống, `cursor` giữ mốc sang trang sau | Có | `post-recommendations.use-cases.spec.ts` (45/45 pass) |
| OpenAPI contract cập nhật | Có | `contracts/openapi/core-api.json` sinh từ `pnpm contracts:build` |
| Lint, typecheck, test pass | Có | `pnpm turbo run lint typecheck test --affected`: 49/49 task pass |

## Kết quả kiểm tra

- `pnpm contracts:build`: thành công (11/11 build tasks, export schema & OpenAPI spec).
- `pnpm turbo run lint typecheck test --affected`: **49/49 task thành công** (`@tripflix/core-api:test`: 199 files passed, 2 skipped [có sẵn]; 3199 tests passed, 4 skipped [có sẵn]; `post-recommendation-query.spec.ts`: 2/2 passed; `post-recommendations.use-cases.spec.ts`: 45/45 passed).

## Cách kiểm lại

1. Chạy `pnpm --filter @tripflix/core-api test -- src/modules/discovery/recommend/api/post-recommendation-query.spec.ts src/modules/discovery/recommend/application/post-recommendations.use-cases.spec.ts`.
2. Gọi `GET /api/recommendations/posts?mode=for_you` khi đã đăng nhập, sau đó gọi lại với `fresh=true` trong vòng 30 phút để xác nhận trang đầu đổi thứ tự (đẩy bài vừa gợi ý xuống), còn phân trang bằng `cursor` tiếp theo giữ nguyên phiên.

## Ảnh / video

- Không đổi giao diện ở BE.

## Ảnh hưởng tới phần của người khác

- Không: chỉ sửa trong module `discovery` (của Duy) và sinh lại `contracts/openapi/core-api.json`.
