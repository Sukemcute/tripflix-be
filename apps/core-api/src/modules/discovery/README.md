# Module `discovery`

- Chủ: Duy (backup Dũng)
- Database: `core`, schema `discovery`, user Postgres `tf_discovery`
- Bảng chính dự kiến: `search_documents`, `interaction_signals`, `recommendation_cache`

## Phần con

- search: bài đăng, khách sạn, vé (tsvector, unaccent, pg_trgm, pgvector)
- recommend: gợi ý bài, gợi ý mục còn thiếu ở bước xác nhận

## Khuôn thư mục

Mỗi phần con (`search/`, `recommend/`) chia:

```
<phần-con>/
├─ api/           # controller, DTO; không mở transaction
├─ application/   # use case, @Transactional('discovery'), ghi outbox
├─ domain/        # quy tắc nghiệp vụ thuần, không import @nestjs/* hay drizzle-orm
├─ infra/         # repository Drizzle, client dịch vụ ngoài
├─ consumers/     # nghe sự kiện (chỉ chạy khi APP_ROLE là worker hoặc all)
└─ jobs/          # job định kỳ (như trên)
```

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate discovery`. Không sửa migration đã merge.
