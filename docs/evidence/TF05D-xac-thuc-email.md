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

## Cập nhật luồng đăng ký bằng mã

- API cấp mã chỉ lưu yêu cầu xác thực và phát sự kiện gửi email. Mã gồm 8 chữ số và hết hạn sau 10 phút. Yêu cầu mới thay mã cũ.
- API đăng ký kiểm lại mật khẩu 12–128 ký tự, từ chối các mẫu dễ đoán và bắt buộc mã hợp lệ cho đúng địa chỉ email. Tạo tài khoản và tiêu mã trong cùng transaction. Tài khoản có email đã xác thực ngay khi tạo.
- Kiểm thử bằng Chromium và Mailpit đã xác nhận rằng mật khẩu yếu bị chặn, gọi thẳng API thiếu mã bị từ chối và đăng nhập chưa được phép trước khi nhập đúng mã.
- Test tích hợp Access qua 28/28 bài với Postgres và Redis thật. Hai yêu cầu đồng thời dùng cùng mã chỉ tạo được một tài khoản.

## Cập nhật: báo email đã có tài khoản, chờ 60 giây giữa hai lần xin mã

- Xin mã bằng email đã có tài khoản đang hoạt động vẫn trả `202` như email mới, không tạo mã, để không lộ email nào đã đăng ký. Hệ thống phát `access.registration_attempted_existing` v1, và `notification-service` gửi thư "Email này đã có tài khoản Tripflix" có link đăng nhập và quên mật khẩu. Tài khoản Google thì hướng dẫn tạo mật khẩu. Tài khoản bị khoá thì không gửi thư. Mã được băm ở cả hai nhánh để thời gian trả lời như nhau.
- Mỗi email xin mã cách nhau ít nhất 60 giây, áp dụng như nhau cho email mới và email đã có tài khoản. `202` trả thêm `resendAfterSeconds`. Xin sớm hơn trả `429`, có `Retry-After` và `retryAfterSeconds` trong body.
- Chỉ thêm trường và sự kiện mới, không đổi trường cũ. Đã chạy `pnpm contracts:build` (`contracts/events/access.registration_attempted_existing.v1.schema.json`, `contracts/openapi/core-api.json`).
- Test: `email-verification.e2e.spec.ts` có 2 bài mới (email đã có tài khoản, thời gian chờ). Mẫu thư được kiểm trong `existing-account.email.spec.ts` và `event-router.spec.ts`.
- Kết quả sau khi merge `origin/develop`: `pnpm turbo run lint typecheck test --affected` có 49/49 task pass. core-api 631 pass và 1 skip, notification-service 24/24 pass.
- Chạy thật trên máy local qua gateway `:8080`, gửi qua SMTP Gmail. Lần xin đầu trả `202 { resendAfterSeconds: 60 }`, xin lại ngay trả `429 { retryAfterSeconds: 60 }`. Thư báo đã có tài khoản đã được gửi tới hộp thư thật.

## Cập nhật: mật khẩu mới tối đa 64 ký tự, tên hiển thị tối đa 30 ký tự

- Nhánh `dung/TF05D-gioi-han-mat-khau-va-ten` · 2026-11-06
- Thêm `NEW_PASSWORD_MAX = 64` cho mật khẩu mới khi đăng ký, xin mã đăng ký, đổi mật khẩu và đặt lại mật khẩu. Mật khẩu đang dùng (đăng nhập, mật khẩu hiện tại) vẫn nhận tới 128 ký tự (`PASSWORD_MAX`), để tài khoản đã đặt mật khẩu dài từ trước không bị khoá.
- `DISPLAY_NAME_MAX` giảm từ 50 xuống 30, áp dụng khi đăng ký, sửa hồ sơ và với tên lấy từ Google (`buildDisplayName` cắt còn 30). Tên đã lưu dài hơn 30 vẫn giữ nguyên, lần sửa sau phải rút gọn. Database local có 4 tài khoản như vậy.
- OpenAPI đổi `maxLength`. Đây là thay đổi hợp đồng có thu hẹp, Dũng đã đồng ý. Đã chạy `pnpm contracts:build`.
- Test: `validation.spec.ts` kiểm 64 nhận, 65 từ chối cho mật khẩu mới, đăng nhập vẫn nhận 128, tên 30 nhận và 31 từ chối (có đếm emoji). `text-rules.spec.ts` kiểm Google cắt còn 30.
- `pnpm turbo run lint typecheck test --affected`: 49/49 task pass, core-api 631 pass và 1 skip.
