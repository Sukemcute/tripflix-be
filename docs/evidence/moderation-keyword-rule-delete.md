# Xóa quy tắc từ khóa tùy chỉnh

Superadmin có thể xóa một quy tắc tùy chỉnh theo UUID. Endpoint trả 204 và dùng Idempotency-Key để xử lý an toàn khi gửi lại.

| Kiểm tra | Kết quả |
|---|---|
| Quyền truy cập, xác thực UUID và gửi lại yêu cầu | Pass trong bộ kiểm thử HTTP |
| Kiểm thử HTTP của Kiểm duyệt và bộ so khớp từ khóa tùy chỉnh | 15 ca pass |
| Lint, typecheck, test affected và sinh lại OpenAPI sau khi đồng bộ develop | 13 tác vụ thành công và hợp đồng khớp |
| Kiểm thử tích hợp PostgreSQL cho thao tác xóa | Docker local không khởi động được container. CI sẽ chạy lại. |

Ca PostgreSQL kiểm tra quy tắc đã xóa không gắn cờ nội dung mới, hồ sơ cũ còn tra cứu được và có thể tạo lại cùng từ khóa.
