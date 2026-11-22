# TF056 — Bảo vệ dữ liệu phiên đăng nhập

- Nhánh `dung/TF056-an-toan-phien-dang-nhap` · Dũng (dùng AI) · 2026-11-10

## Thay đổi

- Log HTTP giữ ID request, method, đường dẫn và mã trạng thái. Loại header, body và giá trị query khỏi bản ghi request/response.
- Response đăng nhập và làm mới phiên web chỉ chứa `accessToken`, `tokenType` và `expiresIn`. Refresh token đi qua cookie HttpOnly. Mobile tiếp tục dùng hợp đồng hiện tại.
- Thêm `Cache-Control: no-store` cho đăng nhập bằng mật khẩu, Google, làm mới phiên và hồ sơ hiện tại.

## Kiểm tra

| Tiêu chí | Bằng chứng |
| --- | --- |
| Log giữ dữ liệu chẩn đoán và không chứa thông tin xác thực mẫu | Test observability kiểm cả header request, cookie response, query và body |
| Response web và hồ sơ chỉ có các trường dự kiến | `web-cookie.e2e.spec.ts` kiểm toàn bộ trường trả về khi đăng ký, đăng nhập, refresh và đọc hồ sơ |
| Hai tài khoản có phiên độc lập, khách không đọc được hồ sơ | Test đăng nhập đồng thời và kiểm cookie khác nhau, hồ sơ đúng tài khoản và HTTP 401 khi thiếu token |

- Core API typecheck và lint các file thay đổi đạt. Suite Access đạt 302 test.
- Observability lint và typecheck đạt. Test logger đạt 1/1.
- Kiểm tra dùng dữ liệu giả ở local. Cần đối chiếu trace của mentor để xác định ca xảy ra trên production.

## Phạm vi ảnh hưởng

- `access` và `libs/observability` do Dũng phụ trách. Cấu hình log HTTP dùng chung cho Core API và notification-service.
- Không có migration hoặc thay đổi hình dạng hợp đồng API.
