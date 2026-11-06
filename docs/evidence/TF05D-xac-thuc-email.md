# TF05D — Xác thực email và giới hạn đăng ký

- Nhánh `dung/TF05D-xac-thuc-email` · Hoàng Đức Dũng · Có dùng AI · 2026-11-06

## Đã làm

- Đăng ký bằng mật khẩu gửi một email chào mừng kèm liên kết xác thực dùng một lần, có hiệu lực 24 giờ. Link cũ hết hiệu lực khi gửi lại. Các yêu cầu đồng thời được xử lý theo từng tài khoản.
- Tài khoản chỉ dùng mật khẩu tạo trước TF05D cần xác thực lại. Đăng nhập Google và đặt lại mật khẩu qua email cũng xác thực địa chỉ. Ba tài khoản seed local được đánh dấu đã xác thực.
- Giới hạn đăng ký mặc định 5 lần mỗi IP mỗi giờ. Gửi lại giới hạn 3 lần mỗi tài khoản và 20 lần mỗi IP mỗi giờ.
- Tạo bản nháp, đăng bài và tạo bình luận trả `403` với mã `email_unverified` khi email chưa được xác thực. Sau khi xác thực, client làm mới phiên để nhận claim `ev` mới.
- Sinh lại OpenAPI và schema sự kiện. Cấu hình profile `mail` cho notification-service trên server và ghi quy trình SES trong [SERVER.md](../../deploy/SERVER.md).

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --affected` thành công 49/49 tác vụ. Core API có 613 bài test qua và 1 bài được bỏ qua sẵn. Lint có 81 cảnh báo và 0 lỗi.
- Bộ test tích hợp Access qua 27/27 bài với Postgres và Redis thật, gồm dùng đồng thời một link và hai yêu cầu gửi lại đồng thời.
- Kiểm thử trên Chromium với Core API, notification-service, Postgres, Redis và Mailpit. Đăng ký nhận một thư, gửi lại vô hiệu link cũ, mở link mới xác thực được, làm mới phiên rồi tạo bản nháp, đăng bài và bình luận thành công. API từ chối link đã dùng.
- `node tools/check-boundaries.mjs` thành công. Docker Compose server đã qua kiểm tra cấu hình với giá trị giả lập.

## Cách kiểm lại

1. Chạy Core API, notification-service, Postgres, Redis và Mailpit với cấu hình dev. Chạy migration rồi mở bản web TF05D.
2. Tạo tài khoản bằng mật khẩu, kiểm tra email chào mừng trong Mailpit và xác nhận yêu cầu đăng bài bị chặn.
3. Gửi lại liên kết từ trang tài khoản. Kiểm tra link đầu tiên bị từ chối và link mới xác thực được.
4. Làm mới phiên, tạo bản nháp, đăng bài và bình luận. Mở lại link đã dùng để kiểm tra API từ chối.

## Ảnh hưởng đến phần của người khác

- Thay đổi ở `content/social` của Thành. Dũng xác nhận đã báo Thành và đồng ý thực hiện.
- Việc triển khai cần phối hợp với bản web TF05D và cấu hình SMTP trên môi trường đích.
