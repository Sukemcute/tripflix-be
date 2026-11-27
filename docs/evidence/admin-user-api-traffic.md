# Tách luồng API quản trị và người dùng

Ngày 2026-11-27. Nhánh trang/tach-luong-admin-user.

- Access và Discovery thêm route riêng cho phiên Admin, tìm kiếm và gợi ý. Giữ hợp đồng các route Web/Mobile. Route giám sát tìm kiếm không phát sự kiện tìm kiếm của người dùng.
- Middleware gắn nhãn luồng cho request theo route phía server. API tổng quan lọc số liệu HTTP theo nhãn; heartbeat, RSS và uptime vẫn tính theo dịch vụ.
- Build và sinh lại hợp đồng trên develop mới nhất không phát sinh diff ngoài hợp đồng đã chuẩn bị. 43 test Core API và 13 test telemetry pass.
- Sau khi deploy backend trên staging, kiểm tra route Admin mới và tình trạng API công khai trước khi mở PR Portal để merge.
