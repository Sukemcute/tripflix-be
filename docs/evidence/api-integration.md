# Tích hợp FE – hợp đồng social

- Ngày: 2026-11-05 · Nhánh: `trang/noi-api-fe-be`, từ `develop` (`f0bce3b`).
- Người dùng đã duyệt nối API thật trên web/admin/mobile và cập nhật phần BE cần cho tích hợp trong chat. Chưa có mã task/Notion.

## Thay đổi

- Thêm `content/social/api/dto/response.dto.ts` mô tả JSON hiện có của post, page, detail, comment, reaction, bookmark, moderation và share.
- Gắn response DTO vào controller, chạy `pnpm contracts:build`; FE chạy lại `pnpm gen:api`. Không sửa tay OpenAPI hoặc client sinh ra.
- Giữ nguyên tên JSON hiện tại, bao gồm các field snake_case của một số endpoint social. Không đổi schema DB hay migration.
- Bổ sung mô tả HTTP 201 thực tế của publish, giữ mô tả 200 cũ để tương thích.
- Thêm `SocialErrorFilter`: lỗi không tìm thấy/không được xem bài → 404, không được thao tác → 403, chuyển trạng thái không hợp lệ → 409, validation domain → 422. Trước đây những lỗi domain không được ánh xạ này trả 500.
- Thêm 3 regression test HTTP cho filter, bao gồm bài bị ẩn/không tồn tại.
- Bổ sung ghi chú origin Expo web trong `.env.example`; không đọc hoặc commit `.env`.

## Kiểm chứng

- `pnpm contracts:build`, lint/typecheck/test của BE: pass. Tổng 268 test, bao gồm 208 test core-api.
- `pnpm --filter @tripflix/core-api test:int`: 17 test database pass với Docker.
- Lint còn 42 warning ở test social đã có trước thay đổi; không có error hoặc vi phạm module boundary.
- Health thực tế trên API local: cả 5 pool Postgres và Redis đều hoạt động.
- Đã migrate, seed 220 khách sạn/642 loại phòng/313 hạng ghế và mở lịch local. Volume cũ cần bổ sung quyền CREATE bằng đúng GRANT trong script init hiện tại; đã xử lý mà không xóa dữ liệu.
- Playwright kiểm tra FE trên web/admin/Expo web với core-api + Postgres + Redis thật; xem `../tripflix-fe/docs/evidence/api-integration.md` từ thư mục cha hai repo và `tests/e2e/api-integration.cjs` ở FE.

## Chủ sở hữu và phạm vi

- BE social: Thành; cấu hình ví dụ access: Dũng. Phạm vi đã được người dùng đồng ý trong chat.
- Không merge các nhánh chức năng chưa vào develop, không triển khai thêm booking/payment/media completion/analytics.
- Chưa kiểm thử giao diện Android trên thiết bị. Bản mobile web và bundle Android được kiểm tra riêng ở FE.
