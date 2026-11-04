# Module `commerce`

- Chủ: Thắng (backup Bảo)
- Database: `commerce`, schema `commerce`, user Postgres `tf_commerce`
- Bảng chính dự kiến: `properties`, `room_types`, `room_inventory`, `room_rates`, `flights`, `flight_inventory`, `orders`, `order_items`, `payments`, `refunds`

## Phần con

- inventory: khách sạn, loại phòng, chuyến bay, giá và lịch trống theo ngày; job mở lịch 180 ngày, 6 giờ/lần
- booking: đơn, giữ chỗ 30 phút, job hết hạn mỗi phút
- payment: cổng giả lập, đối soát, hoàn huỷ

Database riêng `commerce`. Không module nào kết nối thẳng database này; module khác gọi qua `CommerceModule` export trong `index.ts`.

## Khuôn thư mục

Mỗi phần con (`inventory/`, `booking/`, `payment/`) chia:

```
<phần-con>/
├─ api/           # controller, DTO; không mở transaction
├─ application/   # use case, @Transactional('commerce'), ghi outbox
├─ domain/        # quy tắc nghiệp vụ thuần, không import @nestjs/* hay drizzle-orm
├─ infra/         # repository Drizzle, client dịch vụ ngoài
├─ consumers/     # nghe sự kiện (chỉ chạy khi APP_ROLE là worker hoặc all)
└─ jobs/          # job định kỳ (như trên)
```

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate commerce`. Không sửa migration đã merge.
