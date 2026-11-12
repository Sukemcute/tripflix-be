# TF25 — Chặn tương tác với bài không được xem và ẩn PII trong danh sách

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-chan-tuong-tac-bai-an-va-an-pii` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-12

## Đã làm
- **Fail-closed khi tương tác**: thống kê (`GET /v1/posts/:id/stats`), thả cảm xúc, lưu bài đều kiểm tra `canBeViewedBy`. Bài ẩn, bị gỡ, nháp hoặc riêng tư của người khác trả 404 như bài không tồn tại, không lộ là bài có thật. Staff (moderator, superadmin) vẫn xem được thống kê.
- **Ẩn `bookingId`** trong danh sách bài công khai và danh sách đã lưu (trước đây chỉ chi tiết bài mới ẩn).
- **Danh sách đã lưu** không trả bài riêng tư của người khác (vẫn giữ bài riêng tư của chính mình).
- **Loại cảm xúc lạ** bị từ chối bằng `InvalidReactionTypeException` trước khi ghi xuống DB.
- **Lưu bài** chạy trong `@Transactional('content')` và khoá dòng bài như thả cảm xúc.
- **Xuất bản đồng thời**: kiểm tra lại trạng thái trong khoá dòng nên lượt thứ hai trả 409, không đăng hai lần.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Không xem thống kê / tương tác được với bài không có quyền xem | Có | `social-use-cases.spec.ts` › Bảo vệ quyền riêng tư khi tương tác (TF25): thống kê, cảm xúc, lưu bài |
| Danh sách không lộ `bookingId` | Có | cùng nhóm › danh sách bài công khai…, danh sách đã lưu… |
| Đã lưu không lộ bài riêng tư của người khác | Có | cùng nhóm › danh sách đã lưu bỏ bài riêng tư của người khác… |
| Không xuất bản hai lần khi bấm đồng thời | Có | cùng nhóm › hai lượt xuất bản cùng lúc… |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: lint 0 lỗi, typecheck sạch, **2182 test pass, 1 skip** (thêm 8 test).

## Cách kiểm lại
1. `pnpm install && pnpm turbo run lint typecheck test --filter=@tripflix/core-api`
2. Đăng bài riêng tư bằng tài khoản A, dùng tài khoản B gọi `GET /api/v1/posts/<id>/stats` và `PUT /api/v1/posts/<id>/reaction`: cả hai trả 404.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `content/social`. Hợp đồng API không đổi field; `GET /v1/posts/:id/stats` nay nhận token tuỳ chọn để biết người xem.
