# Module `commerce`

- Chủ: Thắng (backup Bảo)
- Database: `core`, schema `commerce`, user Postgres `tf_commerce`
- Bảng chính dự kiến: `properties`, `room_types`, `room_inventory`, `room_rates`, `flights`, `flight_inventory`, `orders`, `order_items`, `payments`, `refunds`

## Phần con

- inventory: khách sạn, loại phòng, chuyến bay, giá và lịch trống theo ngày; job mở lịch 180 ngày, 6 giờ/lần
- booking: đơn, giữ chỗ 30 phút, job hết hạn mỗi phút
- payment: cổng giả lập, đối soát, hoàn huỷ

Schema `commerce` trong database `core` (từ 05/11, trước đó là database riêng). User `tf_commerce` chỉ có quyền trên schema này, module khác không đọc được bảng của commerce; module khác gọi qua `CommerceModule` export trong `index.ts`.

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
