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

4. Trong `tripflix-be`: `pnpm install`, rồi chép `deploy/.env.example` thành `deploy/.env` và điền `DEV_NAME`, key AWS dev (nếu làm phần media), `OPENAI_API_KEY` (nếu chạy AI).

## Chạy

| Lệnh | Dùng khi |
|---|---|
| `pnpm stack:up` | Chạy cả hệ thống trong Docker (BE, AI, web, admin, gateway) |
| `pnpm stack:watch` | Như trên, sửa code thì container tự cập nhật |
| `pnpm stack:be` | Chỉ BE + gateway |
| `pnpm stack:infra` | Chỉ Postgres, Redis, Mailpit; app của mình chạy trên máy bằng `pnpm dev` |
| `pnpm stack:tools` | Adminer, RedisInsight |
| `pnpm stack:logs`, `pnpm stack:ps` | Xem log, trạng thái |
| `pnpm stack:down` | Dừng, giữ dữ liệu |
| `pnpm stack:reset` | Xoá sạch dữ liệu local (hỏi team trước khi dùng trên máy chung) |

Chạy app trên máy: `pnpm stack:infra`, chép `apps/<app>/.env.example` thành `apps/<app>/.env`, rồi `pnpm dev` (tất cả app) hoặc `pnpm --filter @tripflix/core-api dev`.

| Địa chỉ | Là gì |
|---|---|
| http://localhost:8080 | Gateway: `/api` → core-api, `/notifications`, `/ws` → notification-service, `/ai` → ai-service |
| http://localhost:3000/docs | Swagger core-api |
| http://localhost:3000/health | Kiểm kết nối 5 module tới Postgres và Redis |
| http://localhost:3100, :3200 | Web, Admin |
| http://localhost:8000/docs | ai-service |
| http://localhost:8025 | Mailpit (email gửi đi) |
| http://localhost:8081 | Traefik dashboard |
| localhost:5432, :6379 | Postgres (`postgres`/`postgres`), Redis |

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
| `pnpm contracts:build` | Sinh `contracts/openapi/*.json` và `contracts/events/*.schema.json`; commit kết quả |

## Cấu trúc

```
apps/
  core-api/              # 5 module: access, content, discovery, commerce, analytics (README trong từng module)
  notification-service/  # khung, chưa có consumer
  video-worker/          # khung, image có FFmpeg
libs/
  config/  contracts/  db/  event-bus/  observability/   # đã có
  outbox/  auth/  idempotency/  storage/  testing/        # chưa làm, xem README từng thư mục
contracts/               # file sinh ra, có commit; FE, AI đọc từ đây
deploy/                  # compose.yaml, init Postgres, Traefik, ghi chú AWS
tools/                   # script kiểm ranh giới module
docs/architecture/       # kiến trúc; docs/evidence/ # evidence của từng task
```
