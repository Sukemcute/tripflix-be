# Module `analytics`

- Chủ: Trang (backup Thành)
- Database: `core`, schema `analytics`, user Postgres `tf_analytics`
- Bảng chính dự kiến: `events` (partition theo ngày, giữ 90 ngày), `snapshot_*`, `mart_*`

## Phần con

- ingest: nghe mọi stream bằng group core-analytics, ghi lô vào events
- marts: job 5 phút làm mới bảng mart_*
- api: /api/analytics/* cho superadmin, moderator

Chỉ nhận dữ liệu qua sự kiện, chỉ đọc bảng của mình. Pool kết nối giới hạn 3 để không chiếm kết nối của module khác.

## Khuôn thư mục

Mỗi phần con (`ingest/`, `marts/`, `api/`) chia:

```
<phần-con>/
├─ api/           # controller, DTO; không mở transaction
├─ application/   # use case, @Transactional('analytics'), ghi outbox
├─ domain/        # quy tắc nghiệp vụ thuần, không import @nestjs/* hay drizzle-orm
├─ infra/         # repository Drizzle, client dịch vụ ngoài
├─ consumers/     # nghe sự kiện (chỉ chạy khi APP_ROLE là worker hoặc all)
└─ jobs/          # job định kỳ (như trên)
```

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate analytics`. Không sửa migration đã merge.
