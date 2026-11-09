# tripflix-be

Backend Tripflix: `core-api` (modular monolith 5 module), `notification-service`, `video-worker`, và hạ tầng chạy local cho cả hệ thống.

**Đọc [RULES.md](RULES.md) trước khi làm việc.** Kiến trúc: [docs/architecture/](docs/architecture/).

## Cài đặt lần đầu

1. Cài Node 24 LTS (`nvm install 24 && nvm use 24`), Docker Desktop (WSL2, cấp ≥ 6 GB RAM), Git.
2. Bật pnpm: `corepack enable`.
3. Clone 3 repo cạnh nhau:

   ```
   tripflix/
   ├─ tripflix-be/
   ├─ tripflix-fe/
   └─ tripflix-ai/
   ```

4. Trong `tripflix-be`: `pnpm install`, rồi chép `deploy/.env.example` thành `deploy/.env` và điền `DEV_NAME`, key AWS dev (nếu làm phần media), `LLM_PROVIDER` và `DEEPSEEK_API_KEY` (nếu chạy AI với `LLM_PROVIDER=deepseek`; code ở máy thì để `LLM_PROVIDER=fake`, không cần key).

## Chạy

| Lệnh | Dùng khi |
|---|---|
| `pnpm stack:up` | Chạy hệ thống trong Docker (BE, web, admin, gateway), **không có AI** cho nhanh |
| `pnpm stack:watch` | Như trên, sửa code thì container tự cập nhật |
| `pnpm stack:ai` | Bật thêm AI (ai-service + ai-summary-worker) lên stack đang chạy |
| `pnpm stack:ai:down` | Tắt riêng AI, BE vẫn chạy |
| `pnpm stack:full`, `pnpm stack:watch:full` | Cả hệ thống kèm AI |
| `pnpm stack:be` | Chỉ BE + gateway |
| `pnpm stack:infra` | Chỉ Postgres, Redis, Mailpit; app của mình chạy trên máy bằng `pnpm dev` |
| `pnpm stack:tools` | Adminer, RedisInsight |
| `pnpm stack:logs`, `pnpm stack:ps` | Xem log, trạng thái |
| `pnpm stack:down` | Dừng, giữ dữ liệu |
| `pnpm stack:reset` | Xoá sạch dữ liệu local (hỏi team trước khi dùng trên máy chung) |

Chạy app trên máy: `pnpm stack:infra`, chép `apps/<app>/.env.example` thành `apps/<app>/.env`, rồi `pnpm dev` (tất cả app) hoặc `pnpm --filter @tripflix/core-api dev`.

| Địa chỉ | Là gì |
|---|---|
| http://localhost:8080 | Gateway: `/api` → core-api, `/notifications`, `/ws` → notification-service, `/ai` → ai-service. Rate limit theo IP (`deploy/traefik/README.md`) |
| http://localhost:3000/docs | Swagger core-api |
| http://localhost:3000/health | Kiểm kết nối 5 module tới Postgres và Redis |
| http://localhost:3100, :3200 | Web, Admin |
| http://localhost:8000/docs | ai-service |
| http://localhost:8025 | Mailpit (email gửi đi) |
| http://localhost:8081 | Traefik dashboard |
| localhost:5432, :6379 | Postgres (`postgres`/`postgres`), Redis |

## Database

Mỗi người chạy một bản Postgres **trên máy mình**, cùng cấu trúc với cả team. Phần dùng chung là code trong repo (`deploy/postgres/init/`, migration của từng module, seed), không phải một server chung. Database chung là staging (chưa dựng).

Dựng lần đầu, hoặc sau khi pull code có migration mới:

```sh
pnpm stack:infra                     # Postgres, Redis, Mailpit
cp apps/core-api/.env.example apps/core-api/.env
pnpm build && pnpm db:migrate && pnpm db:seed
```

`pnpm stack:up` / `stack:be` tự chạy migrate và seed (service `migrate`), không cần các lệnh trên.

| Có gì | Chi tiết |
|---|---|
| Database | `core` (schema `access`, `content`, `discovery`, `analytics`, `commerce`), `notification` |
| User Postgres | Mỗi module một user (`tf_access`...), chỉ đọc, ghi được schema của mình; mật khẩu dev trong `apps/core-api/.env.example` |
| Tài khoản mẫu (`pnpm db:seed`) | `superadmin@tripflix.local`, `moderator@tripflix.local`, `member@tripflix.local`, mật khẩu `SEED_PASSWORD` trong `.env` (mặc định `tripflix-dev-123`) |
| Xem dữ liệu | `pnpm stack:tools` rồi mở Adminer http://localhost:8090 (server `postgres`, user `postgres`/`postgres`) |

Đã chạy `pnpm stack:infra` **trước** khi pull TF05 thì chạy một lần (không mất dữ liệu), nếu không `pnpm db:migrate` báo `permission denied for database`:

```sh
docker exec tripflix-postgres-1 psql -U postgres -c "GRANT CREATE ON DATABASE core TO tf_access, tf_content, tf_discovery, tf_analytics, tf_commerce" -c "GRANT CREATE ON DATABASE notification TO tf_notification"
```

Đăng nhập, phân quyền, cách dùng `@Roles(...)`: `apps/core-api/src/modules/access/README.md`, `libs/auth/README.md`.

## Kiểm tra (bắt buộc trước khi push)

```
pnpm lint && pnpm typecheck && pnpm test
```

`pnpm lint` chạy thêm `tools/check-boundaries.mjs`: chặn import vào bên trong module khác, chặn `domain/` import `@nestjs/*` hay `drizzle-orm`.

## Lệnh khác

| Lệnh | Làm gì |
|---|---|
| `pnpm db:generate <module>` | Sinh migration cho một module (`access`, `content`, `discovery`, `analytics`, `commerce`) |
| `pnpm db:migrate` | Chạy migration mọi module, mỗi module bằng user Postgres riêng |
| `pnpm db:seed` | Tạo tài khoản mẫu 3 vai trò; chạy lại không tạo trùng; không chạy ở production |
| `pnpm --filter @tripflix/core-api auth:keygen` | In khoá ký access token ES256 cho staging (để trong secret, không commit) |
| `pnpm contracts:build` | Sinh `contracts/openapi/*.json` và `contracts/events/*.schema.json`; commit kết quả |

## Cấu trúc

```
apps/
  core-api/              # 5 module: access, content, discovery, commerce, analytics (README trong từng module)
  notification-service/  # khung, chưa có consumer
  video-worker/          # chuyển mã video bằng FFmpeg, chạy trên Node; sẽ chuyển sang Go
libs/
  auth/  config/  contracts/  db/  event-bus/  observability/   # đã có
  outbox/  idempotency/  storage/  testing/                    # chưa làm, xem README từng thư mục
contracts/               # file sinh ra, có commit; FE, AI đọc từ đây
deploy/                  # compose.yaml, init Postgres, Traefik, ghi chú AWS
tools/                   # script kiểm ranh giới module
docs/architecture/       # kiến trúc; docs/evidence/ # evidence của từng task
```
