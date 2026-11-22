# TF31 — Bài chưa có tóm tắt AI trả 204 thay vì 404

- Notion: TF31 · Nhánh: `bao/TF31-tom-tat-204` · Người làm: Bảo (dùng AI: có) · Ngày: 2026-11-18

## Đã làm
- `GET /api/v1/posts/:postId/ai-summary`:
  - Bài có và xem được nhưng chưa có tóm tắt: trả **204**, body rỗng. Trước đây trả 404, nên trình duyệt báo lỗi đỏ dù giao diện vẫn đúng.
  - Bài không tồn tại hoặc không có quyền xem: vẫn trả **404** (use case giữ nguyên).
  - Bài có tóm tắt: vẫn trả **200**, ETag/304 không đổi.
- Sửa mô tả Swagger (thêm 204, sửa nghĩa 404), sinh lại `contracts/openapi/core-api.json`.
- Mã 304 người dùng thấy ở bài có tóm tắt là cache ETag bình thường, không phải lỗi.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bài chưa có tóm tắt không còn trả 404 | Đạt | `post-summary.e2e.spec.ts`: "GET returns 204 with an empty body…" |
| Bài không tồn tại vẫn 404 | Đạt | "GET returns 404 when the post does not exist" |
| Bài có tóm tắt vẫn 200, ETag/304 giữ nguyên | Đạt | "GET returns 200 with a summary and preserves ETag/304 caching" |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task; 3.177 test pass, 0 fail, 4 skip.
- Chạy lại riêng hai file test phần tóm tắt: 45/45 pass. Lint và typecheck affected: 36/36 task.
- `pnpm contracts:build`: pass.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/social/api/post-summary.e2e.spec.ts`
2. Trên web: mở reel chưa có tóm tắt → request `ai-summary` trả 204, không có lỗi đỏ.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `content/social`, chủ code **Thành** (backup chị Trang). Bảo đã đồng ý; cần Thành duyệt PR.
- **Thứ tự merge:** PR FE (`api-client` đọc 204) và PR AI (worker, Tripi đọc 204) phải merge **trước** PR này. Nếu không, worker tóm tắt sẽ lỗi ở bài chưa có tóm tắt.
