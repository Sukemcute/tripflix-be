# TF25 — Chặn ghi nhận chia sẻ bài không xem được

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-chan-chia-se-bai-an` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- `track-share` trước đây chỉ chặn bài đã xoá. Bài bị ẩn, bị gỡ, riêng tư hay bản nháp của người khác vẫn tăng `shareCount` và phát `content.post.shared`.
- Giờ kiểm `canBeViewedBy` như `set-reaction`, `bookmark-post`, `get-post-stats`: không xem được thì trả 404, không tăng đếm, không ghi outbox.
- Khi Trang thêm trạng thái `held` (TF90), chỉ cần thêm vào `canBeViewedBy` là cả 4 use case cùng chặn.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bài ẩn, gỡ, riêng tư, nháp của người khác: không tăng lượt chia sẻ | Có | `social-use-cases.spec.ts` › TrackShareUseCase chặn bài không xem được (4 ca) |
| Khách chưa đăng nhập vẫn chia sẻ được bài công khai | Có | cùng file › khách chưa đăng nhập |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task pass, 2448 test pass (4 skipped có sẵn), lint 0 lỗi, không có warning mới.

## Cách kiểm lại
1. Ẩn một bài bằng tài khoản staff, gọi `POST /api/v1/posts/<id>/share`: nhận 404, `shareCount` không đổi.

## Ảnh / video
- Không đính kèm (theo yêu cầu).

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa use case social của Thành.
