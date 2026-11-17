# TF101 phần 2 — Tác giả thấy trạng thái bình luận bị ẩn

- Jira: [SCRUM-125](https://tripflix.atlassian.net/browse/SCRUM-125)
- Nhánh: `trang/TF101b-hidden-comment` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- Danh sách trả thêm bình luận hidden/removed của chính tác giả; người khác, kể cả staff không phải tác giả, không nhận các dòng này.
- Danh sách và focusCommentId trả body rỗng, moderationState hidden cho bình luận bị ẩn/gỡ; visible/held giữ nội dung và moderationState null.
- Cập nhật DTO, response tạo/sửa và sinh lại OpenAPI. Không đổi schema DB, sự kiện, bộ đếm bài, lấy mẫu AI hay thống kê.

## Đối chiếu tiêu chí
| Tiêu chí | Bằng chứng |
|---|---|
| Chỉ tác giả thấy hidden/removed; người khác và khách không thấy | comment.repository.int.spec.ts, Postgres thật |
| Không trả body gốc; moderationState hidden | post-summary-and-flat-comments.spec.ts |
| Giữ response tạo/sửa nhất quán với DTO | social.controllers.spec.ts |

## Kết quả kiểm tra
- Regression use case: 23/23 test đạt.
- Integration repository: 3/3 test đạt.
- Typecheck và contracts:build đạt; OpenAPI chỉ thêm moderationState.
- `pnpm turbo run lint typecheck test --affected`: 49/49 task đạt; core-api 2684 test đạt, 4 skipped có sẵn.

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `pnpm --filter @tripflix/core-api test:int -- src/modules/content/social/infra/comment.repository.int.spec.ts` (Docker)

## Ảnh / video
- Thay đổi BE; giao diện thuộc phần TF101 Web/Mobile tiếp theo.

## Ảnh hưởng tới phần của người khác
- content/social và DTO của Thành; Thành duyệt PR theo phân công TF101. Chỉ thêm trường API.
