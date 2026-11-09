# TF25 — Bài viết và feed trả tên hiển thị của tác giả (qua AccessFacade)

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-ten-tac-gia-bai-viet` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-09
- Phạm vi: bổ sung tên hiển thị tác giả cho bài viết (`SocialPostDto.authorName`) và thẻ bảng tin (`FeedCard.author.name`) trong TF25.

## Đã làm
- `SocialPostDto`: thêm trường `authorName` (nullable, không bắt buộc) để client hiển thị đúng tên thật tác giả thay vì fallback ẩn danh.
- `GetPostDetailUseCase`: inject `UserDirectoryPort`, tra cứu tên tác giả qua `AccessFacade.getDisplayNames([authorId])` và gán vào `post.authorName`. Lỗi tra cứu tự động fallback về `null`, không làm sập API.
- `ListPostsUseCase`, `ListUserPostsUseCase`, `ListBookmarksUseCase`: inject `UserDirectoryPort`, gom danh sách `authorId` gọi batch một lần duy nhất chống N+1 và gán `authorName` cho từng bài viết.
- `content.module.ts`: đăng ký inject `USER_DIRECTORY_PORT` cho các use case bài viết.
- `feed.module.ts` & `feed.use-cases.ts`: import `AccessModule`, inject `AccessFacade` và tra cứu `author.name` cho các thẻ video feed, lấp đầy trường `name: null` trước đây.
- `contracts/openapi/core-api.json`: xuất lại OpenAPI schema cập nhật `SocialPostDto.authorName`.
- Bổ sung unit test trong `social-use-cases.spec.ts` kiểm thử việc gán `authorName`.

## Đối chiếu
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Chi tiết và danh sách bài viết trả đúng tên hiển thị tác giả | Đạt | `authorName` trong `SocialPostDto` |
| Video feed trả đúng tên hiển thị tác giả | Đạt | `FeedCard.author.name` được điền qua `AccessFacade` |
| Không vi phạm ranh giới module (kiến trúc micro-modular) | Đạt | Content gọi AccessFacade qua index.ts và port, không truy cập bảng `access.users` |
| Test pass & Typecheck sạch | Đạt | 60 test files pass, 667 tests pass |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `tsc -p tsconfig.json --noEmit` (@tripflix/core-api): pass 100%.
- `vitest run` (@tripflix/core-api): pass 100%.
