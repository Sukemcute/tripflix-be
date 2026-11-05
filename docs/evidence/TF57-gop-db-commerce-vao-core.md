# TF57 — Gộp database commerce vào core

- Notion: — (quyết định `docs/decisions/2026-11-04-commerce-trong-core.md`, nhánh docs `duy/TF57-commerce-schema-trong-core`) · Nhánh: `duy/TF57-gop-db-commerce-vao-core` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-05

## Đã làm

- `deploy/postgres/init/01-databases.sql`: bỏ `CREATE DATABASE commerce`.
- `deploy/postgres/init/02-roles-schemas.sql`: bỏ `commerce` khỏi `REVOKE CONNECT`, bỏ `GRANT CONNECT/CREATE ON DATABASE commerce` và khối `\connect commerce`; `tf_commerce` được `CONNECT`, `CREATE` trên `core`; tạo schema `commerce` và `search_path` trong khối `\connect core`.
- `DATABASE_URL_COMMERCE` trỏ `/core` trong `apps/core-api/.env.example` và `deploy/compose.yaml`.
- `libs/db`: `commerce` vào `CORE_MODULES`, `MODULES = CORE_MODULES` (không đổi tên, không bỏ export); README bảng kết nối.
- `libs/testing`: `commerce` kết nối `core`; `buildAdminUrl` chỉ nhận `'core' | 'notification'`; sửa chú thích "3 database" và README.
- `libs/testing/src/fixtures.int.spec.ts`: giữ ý cũ, đổi sang cách ly theo schema: không còn database `commerce`; có schema `commerce` trong `core`; `tf_commerce` tạo được bảng trong `commerce`; `tf_access` không đọc, không tạo được trong `commerce`; `tf_commerce` không đọc được `access`.
- README gốc, README access (lệnh `GRANT`), README và chú thích `commerce.module.ts`: sửa mô tả database.
- Code commerce, migration, tên biến môi trường: không đổi.

## Đối chiếu "Xong khi"

| Tiêu chí (theo quyết định và góp ý của Dũng) | Đạt | Bằng chứng |
|---|---|---|
| Init SQL chạy được trên volume trống, không còn database `commerce` | Có | `libs/testing` `test:int`: "chạy deploy/postgres/init: đủ database, schema và extension" |
| Cách ly giữ nguyên ý cũ, theo cả hai chiều | Có | `libs/testing` `test:int`: "user của module chỉ dùng được schema của mình" |
| Migrate, store commerce chạy trên `core` | Có | `core-api` `test:int` (store commerce, checkout) 28/28; `pnpm db:migrate` local: "commerce: đã migrate" |
| Đủ các bước CI | Có | Mục dưới |

## Kết quả kiểm tra

- `pnpm lint`: 22/22 task, 0 lỗi (61 cảnh báo có sẵn ở core-api).
- `pnpm typecheck`: 22/22 (sau `pnpm install --frozen-lockfile`, vì develop vừa thêm `@nestjs/testing`, `supertest` cho `libs/auth`).
- `pnpm test`: pass hết (core-api 283/283).
- `pnpm test:int`: 13/13 task; testing 3/3, idempotency 4/4, event-bus 6/6, notification-service 1/1, core-api 28/28.
- `pnpm build`: pass.

Thử tay trên máy có dữ liệu cũ, theo cách giữ dữ liệu ở dưới: `db:migrate` + `db:seed` đưa 220 khách sạn vào `core.commerce`; `/api/suggest?q=vinpearl` 8 kết quả, `/api/stays?placeId=lam-dong…` 10 khách sạn, `/api/recommendations/home` 8 gợi ý; `tf_access` đọc `commerce.__migrations` bị `permission denied for schema commerce`.

## Cách kiểm lại

Máy mới hoặc chấp nhận mất dữ liệu local: `pnpm stack:reset`, rồi `pnpm db:migrate && pnpm db:seed`.

Máy đang có dữ liệu, muốn giữ (không xoá gì; database `commerce` cũ để đó hoặc tự xoá):

```sh
docker exec tripflix-postgres-1 psql -U postgres -d core -v ON_ERROR_STOP=1 -c "GRANT CONNECT, CREATE ON DATABASE core TO tf_commerce" -c "CREATE SCHEMA IF NOT EXISTS commerce AUTHORIZATION tf_commerce" -c "ALTER ROLE tf_commerce IN DATABASE core SET search_path = commerce, public"
```

Sau đó sửa `DATABASE_URL_COMMERCE` trong `apps/core-api/.env` thành `postgres://tf_commerce:tf_commerce_dev@localhost:5432/core`, rồi `pnpm build && pnpm db:migrate && pnpm db:seed`.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Có, đã báo và được Dũng duyệt kế hoạch (05/11): `deploy/`, `libs/db`, `libs/testing`, README access (Dũng); README gốc, `compose.yaml` (Tech Lead); README và chú thích `commerce.module.ts` (Thắng, chỉ chữ, không đổi code).
- PR #43 của Thắng cũng sửa `apps/core-api/.env.example` và `commerce.module.ts`: có thể xung đột nhẹ, giữ cả hai thay đổi.
