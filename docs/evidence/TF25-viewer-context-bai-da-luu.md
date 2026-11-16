# TF25 — viewerContext cho danh sách bài đã lưu

- Notion: TF25 · Nhánh: `thanh/TF25-viewer-context-bai-da-luu` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- `ListBookmarksUseCase` (GET /api/v1/me/bookmarks) tra cảm xúc của người xem cho cả trang bằng một câu (`findByPostsAndUser`) và trả `viewerContext: { myReaction, isBookmarked: true }` cho từng bài, cùng dạng với GET /api/v1/posts.
- Lý do: tab "Đã lưu" trên web đọc `post.viewerContext` để tô tim và nút lưu. Thiếu field này thì sau khi tải lại, tim trắng, nút lưu tắt; bấm tim lại làm số nhảy 6 → 7 → 6 vì server upsert lượt thích đã có.
- `SocialPostPageDto` đã có `viewerContext` từ PR #119 nên hợp đồng API không đổi (`pnpm contracts:build` không sinh khác biệt).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bài đã lưu trả đúng trạng thái thích của người xem | Đạt | `social-use-cases.spec.ts` › "gắn viewerContext cho từng bài để tab Đã lưu hiện đúng tim và nút lưu sau khi tải lại" |
| Trang rỗng không tra thêm DB | Đạt | "không có bài nào hợp lệ thì không tra cảm xúc" |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công; core-api 2480 test pass, 4 skip sẵn có; lint 0 lỗi.

## Cách kiểm lại
1. Đăng nhập web, thả tim và lưu một bài, mở tab Bài viết › Đã lưu, F5: tim đỏ, nút lưu bật, số tim không đổi khi bấm lại.

## Ảnh / video
- Không đính kèm.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `content/social` (phần của Thành) và chỗ khai báo provider trong `content.module.ts`.
