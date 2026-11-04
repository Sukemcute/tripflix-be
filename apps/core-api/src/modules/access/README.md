# Module `access`

- Chủ: Dũng (backup Duy)
- Database: `core`, schema `access`, user Postgres `tf_access`
- Bảng chính dự kiến: `users`, `sessions`, `password_resets`, `service_clients`, `audit_log`

## Phần con

- auth (đăng ký, đăng nhập, Google, refresh token xoay vòng)
- sessions
- staff (superadmin tạo moderator, khoá tài khoản)
- jwks (khoá công khai cho gateway và service khác)

## Khuôn thư mục

Mỗi phần con (`auth/`, `sessions/`, `staff/`) chia:

```
<phần-con>/
├─ api/           # controller, DTO; không mở transaction
├─ application/   # use case, @Transactional('access'), ghi outbox
├─ domain/        # quy tắc nghiệp vụ thuần, không import @nestjs/* hay drizzle-orm
├─ infra/         # repository Drizzle, client dịch vụ ngoài
├─ consumers/     # nghe sự kiện (chỉ chạy khi APP_ROLE là worker hoặc all)
└─ jobs/          # job định kỳ (như trên)
```

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate access`. Không sửa migration đã merge.
