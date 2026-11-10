# TF37 — Link mở lại đơn trong email xác nhận đặt chỗ

- Notion: chưa có · Nhánh: `thang/TF37-link-don-trong-mail` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-10

## Đã làm
- Email xác nhận đặt chỗ (`commerce.order.paid`) có thêm nút "Xem đơn đặt chỗ" và dòng `Xem đơn: <link>` trong bản chữ, trỏ tới `<WEB_APP_URL>/checkout/<orderId>`. Khách mở lại đơn ngay từ email thay vì phải tự tìm trong "Chuyến đã đặt".
- `buildOrderConfirmationEmail` nhận thêm `webAppUrl`, lấy từ `WEB_APP_URL` như email chào mừng. Chỉ `EventRouter` gọi hàm này.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Email có link đúng đơn, cả bản HTML và bản chữ | Có | `event-router.spec.ts`: "email xác nhận có link mở lại đơn trên web" |
| Không đổi nội dung email đang có | Có | Các test email xác nhận cũ vẫn pass |

## Kết quả kiểm tra
`pnpm turbo run lint typecheck test --filter=@tripflix/notification-service...`: 31/31 task thành công; notification-service 5 file, 28 test pass, lint 0 lỗi.

## Cách kiểm lại
1. Chạy stack local, đặt và thanh toán một đơn có nhập email liên hệ.
2. Mở Mailpit `http://localhost:8025`, bấm "Xem đơn đặt chỗ" trong email xác nhận, trang đơn mở đúng mã đơn.

## Ảnh / video
- Chưa có.

## Ảnh hưởng tới phần của người khác
- Có: `apps/notification-service` (chủ Dũng). Chỉ sửa email xác nhận đặt chỗ do Thắng viết (TF37) và một dòng gọi hàm trong `event-router.ts`; không đổi sự kiện, API hay cấu hình. Cần Dũng duyệt PR.
