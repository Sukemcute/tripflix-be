# TF25 — Đánh dấu deprecated tham số `keyword` của GET /v1/posts

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-deprecate-keyword-posts` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-12

## Bối cảnh
Web chuyển hẳn sang tìm bài bằng discovery (`POST /api/search/posts`, PR FE `thanh/TF25-tim-kiem-grid-web`). Tham số `keyword` (ILIKE tiêu đề/nội dung) của `GET /v1/posts` không còn client nào gọi: đã kiểm FE web, mobile và `tripflix-ai` (`iter_public_posts` chỉ gửi `limit`, `cursor`).

## Đã làm
- `ListPostsQueryDto.keyword`: thêm `deprecated: true` và mô tả chỉ sang discovery. Logic giữ nguyên để client cũ không lỗi; gỡ hẳn ở bản sau.
- `pnpm contracts:build`: `contracts/openapi/core-api.json` chỉ đổi `deprecated` + mô tả của tham số.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Hợp đồng ghi `keyword` là deprecated | Có | `contracts/openapi/core-api.json` (`"deprecated": true`) |
| Không đổi hành vi, không phá client cũ | Có | Chỉ đổi decorator Swagger; test core-api pass |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected` — 49/49 task; core-api 2235 test pass (1 skipped có sẵn); lint 0 lỗi.

## Cách kiểm lại
1. `pnpm contracts:build` rồi xem tham số `keyword` của `GET /api/v1/posts` trong `contracts/openapi/core-api.json`.
2. `GET /api/v1/posts?keyword=da` vẫn trả kết quả như trước.

## Ảnh / video
- Không có (không đổi giao diện).

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `content/social` (anh Thành phụ trách) và `contracts/` sinh lại.
