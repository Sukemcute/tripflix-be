# TF25 — Gỡ tham số keyword của GET /v1/posts

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-go-keyword-posts` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Gỡ `keyword` (tìm ILIKE trong tiêu đề, nội dung) khỏi DTO, controller, `list-posts` và `post.repository`; sinh lại `contracts/`.
- `keyword` đã deprecated từ #160 (12/11). Tìm bài đi qua `POST /search/posts` của discovery.
- Anh Thành đã xác nhận gỡ (16/11), dù RULES mục 10 chỉ cho thêm trường: tham số đã đi đủ quy trình deprecated ở mục 3.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Không còn ai gọi `keyword` | Có | Tìm ở cả 3 repo: web, mobile dùng `searchPublicPosts`/`usePostSearchFeed` (discovery); AI service không truyền `keyword` |
| Hợp đồng cập nhật | Có | `pnpm contracts:build`: `core-api.json` bỏ tham số `keyword` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task pass, 2443 test pass (4 skipped có sẵn), lint 0 lỗi.

## Cách kiểm lại
1. `GET /api/v1/posts?keyword=abc`: trả danh sách bình thường, không lọc, không lỗi.

## Ảnh / video
- Không đính kèm (theo yêu cầu).

## Ảnh hưởng tới phần của người khác
- Không: code social của Thành. Client cũ (app mobile cài trước TF11, nếu còn) gửi `keyword` sẽ nhận danh sách không lọc thay vì kết quả tìm.
- FE: sau khi merge, chạy `pnpm gen:api` để client sinh ra bỏ `keyword` (PR riêng).
