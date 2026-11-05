# TF24 — Khắc phục lỗ hổng nghiệp vụ Domain và Trạng thái xác thực

- Notion: https://notion.so/tripflix/TF24 · Nhánh: `thanh/TF24-fix-domain-business-rules` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Chặn Reply lồng cấp 2 (Comment chỉ 1 cấp)**: Thêm ngoại lệ `InvalidCommentNestingException` và phương thức `Comment.validateParentForReply(parent)` trong domain. Trong `AddCommentUseCase`, nếu bình luận cha đã có `parentCommentId != null`, hệ thống lập tức từ chối và chặn không cho lồng nhánh cấp 2 (tuân thủ PRD).
- **Tự động hạ cờ `isVerified = false` khi sửa lộ trình**: Trong `post.entity.ts` (`update()`) và `UpdatePostUseCase`, nếu tác giả sửa đổi `tripAttachment`, dấu "Đã xác thực" cũ tự động bị thu hồi để tránh gian lận sau khi đã duyệt.
- **Khôi phục trạng thái hợp lệ khi Admin/Moderator bấm `restore`**: Trong `Post.moderate('restore')`, nếu bài viết đã từng xuất bản (`publishedAt != null`) thì khôi phục về `published`; nếu bài gốc vốn là bản nháp (`draft`) bị ẩn nhầm thì khôi phục về `draft` (không ép bài nháp thành bài xuất bản công khai).
- **Sửa mock Commerce**: Đổi mock `verifyCompletedBooking` trong `content.module.ts` sang trả về `false` mặc định khi chưa kết nối module Commerce thật.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Chặn reply lồng cấp 2, chỉ cho phép bình luận tối đa 1 cấp | Đạt | Test `Comment Entity` & `AddCommentUseCase` ("chặn reply của reply") pass |
| Tự động hạ `isVerified = false` khi tác giả sửa lộ trình chuyến đi | Đạt | Test `Post Entity` & `UpdatePostUseCase` ("hạ isVerified về false khi sửa tripAttachment") pass |
| Khôi phục bài kiểm duyệt `restore` về đúng trạng thái ban đầu (draft hoặc published) | Đạt | Test `post.entity.spec.ts` ("thao tác kiểm duyệt moderate ẩn và khôi phục bài viết đúng trạng thái") pass |
| Mock Commerce trả về `false` mặc định, không cấp badge ảo | Đạt | Đã kiểm chứng trong `content.module.ts` |
| 100% Lint, Boundary check, Typecheck và Test pass | Đạt | `pnpm check` (134/134 tests pass trên toàn core-api) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm lint`: 0 warnings, 0 errors.
- `pnpm typecheck`: Thành công trên toàn bộ monorepo.
- `pnpm test`: 134/134 tests pass (14 test files pass 100%).

## Cách kiểm lại
1. `cd tripflix-be`
2. `pnpm check`

## Ảnh / video
- Đợt cập nhật Backend Domain & Use Cases: Không thay đổi giao diện frontend.

## Ảnh hưởng tới phần của người khác
- Không ảnh hưởng: Toàn bộ thay đổi nằm độc lập trong `apps/core-api/src/modules/content/social/` và `content.module.ts`. Đã đồng bộ hoàn toàn với `develop` mới nhất (gồm cả PR #16 của Dũng).
