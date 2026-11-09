# TF29: đặt chỗ vẫn chạy khi Redis lỗi

- Notion: chưa có link · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-09 · Nhánh: `thang/TF29-booking-khi-redis-loi`

## Đã làm
- Thêm `@AllowWhenRevocationUnavailable` trong `libs/auth`: kiểm phiên thu hồi tối đa 300 ms, Redis lỗi hoặc chậm thì cho đi tiếp và ghi cảnh báo.
- Chỉ bật cho `CheckoutController` và `VnpayCheckoutController`. API khác giữ nguyên hành vi.

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/auth --filter=@tripflix/core-api`: lint, typecheck pass; auth 27/27.
- core-api 650 pass, 2 fail, 1 skip. Hai test fail ở `content/social` (giới hạn 2.000 ký tự bình luận), cũng fail trên `develop`, không liên quan.
- Chạy thật trên stack riêng gộp 3 nhánh TF29/TF37, Redis đã tắt:

| API | Trước khi sửa | Sau khi sửa |
|---|---|---|
| `POST /api/checkout` | 500 sau 4,8–12,5 giây | 201, khoảng 0,35 giây |
| `PUT /api/checkout/:id/guests` | chưa đo | 200, khoảng 0,33 giây |
| `POST /api/checkout/:id/pay` | chưa đo | 200, khoảng 0,35 giây |
| `GET /api/auth/me` (không bật) | | 500 sau khoảng 10 giây, giữ hành vi cũ |

- Bật Redis lại: mail của đơn đặt trong lúc Redis tắt vẫn tới Mailpit.

## Cách kiểm lại
1. `pnpm stack:be`, seed, đăng nhập tài khoản member.
2. Dừng container redis, đặt và thanh toán một đơn.
3. Bật lại redis, xem Mailpit.

## Ảnh hưởng tới phần của người khác
- Có: `libs/auth` (Dũng). Mặc định không đổi hành vi, cần Dũng duyệt.
- Đánh đổi: lúc Redis sập, token đã thu hồi vẫn đặt chỗ được tới khi hết hạn (tối đa 15 phút).
