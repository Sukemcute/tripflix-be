# Hiển thị luật kiểm duyệt dựng sẵn

API đọc danh sách 9 nhóm luật được lấy từ bộ lọc của backend. Endpoint dành cho Superadmin. Các mẫu so khớp, điểm ưu tiên và hành vi duyệt giữ nguyên.

| Kiểm tra | Kết quả |
|---|---|
| Chưa đăng nhập, Moderator và Superadmin gọi API | Lần lượt nhận 401, 403 và 200 |
| Danh sách luật | Trả đủ 9 nhóm và các mẫu đại diện |
| Bộ kiểm thử luật và HTTP của Kiểm duyệt | 185 ca pass |
| Sinh hợp đồng OpenAPI | Thành công |
| `pnpm turbo run lint typecheck test --affected` | 13 tác vụ thành công, 3.239 ca pass và 4 ca được bỏ qua theo cấu hình hiện có |

Sau khi deploy backend lên staging, kiểm tra mục **Quy tắc dựng sẵn** trên Admin Portal sau khi bản giao diện được triển khai.
