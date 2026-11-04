# TF052 — @Transactional, libs/testing, libs/idempotency

- Notion: <dán link task TF052> · Nhánh: `dung/TF052-transactional-testing-idempotency` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- `@Transactional('<module>')` (`libs/db`): `createTransactionalPlugins()` tạo 5 `ClsPluginTransactional` có `connectionName` riêng (`access`, `content`, `discovery`, `analytics`, `commerce`), adapter Drizzle; `Transactional(module)`, `InjectTransactionHost(module)`, `buildDrizzleToken(module)`. `platform` tách `PlatformCoreModule` (env, pool, Drizzle theo module, Redis) và đăng ký `ClsModule`.
- `libs/testing`: `startPostgres()` (image `pgvector/pgvector:pg17`, chạy `deploy/postgres/init`), `startRedis()`, `migrateModule()`.
- Lệnh `pnpm test:int` cho file `*.int.spec.ts` (Docker), chạy lần lượt từng package; thêm bước trong CI. `pnpm test` không cần Docker.
- `libs/idempotency`: bảng `idempotency_keys`, `DrizzleIdempotencyStore`, `IdempotencyModule.forFeature`, `@Idempotent()`.
- Test DB thật cho `access`: xoay vòng refresh token cùng lúc, rollback transaction.
- README: `libs/db`, `libs/testing`, `libs/idempotency`.
- Thư viện mới (đã được đồng ý, docs/11 chỉ định): `nestjs-cls`, `@nestjs-cls/transactional`, `@nestjs-cls/transactional-adapter-drizzle-orm`, `testcontainers`, `@testcontainers/postgresql`, `@testcontainers/redis`.
- Để PR sau (chờ TF051 merge vì đụng cùng file `access`): chuyển `access` sang `@Transactional('access')`, `OutboxWriter` không cần truyền `tx`, test DB thật cho relay outbox.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Use case khai báo transaction theo module | Có | `libs/db/src/transactional.spec.ts`: trong `@Transactional('access')` lấy đúng tx của access |
| Transaction không lẫn sang module khác | Có | Cùng test: kết nối `commerce` vẫn là kết nối thường, không mở transaction |
| Lỗi thì rollback | Có | `transactional.spec.ts` (lỗi được ném ra); `drizzle-access.store.int.spec.ts > transaction lỗi thì rollback` trên Postgres thật |
| App khởi động được với 5 kết nối có tên | Có | Chạy `core-api` trên Postgres local: `/health` 200, cả 5 module và Redis `true`; đăng nhập tài khoản mẫu 200 |
| Test dùng Postgres, Redis thật với quyền theo module | Có | `libs/testing/src/fixtures.int.spec.ts`: đủ 3 database, schema, extension `vector`; `tf_access` bị chặn ở `content` và database `commerce` |
| Xoay vòng refresh token đúng khi nhiều request cùng lúc (docs/11 §6) | Có | `drizzle-access.store.int.spec.ts`: 10 lệnh cùng lúc chỉ 1 thành công |
| Gửi lại cùng `Idempotency-Key` không xử lý lần hai | Có | `interceptor.spec.ts` (7 ca: thiếu key 400, trả lại kết quả cũ, giữ `@HttpCode`, khác thứ tự khoá, khác body 422, đang xử lý 409, lỗi thì xử lý lại được) |
| Nhiều request cùng key cùng lúc chỉ 1 được xử lý | Có | `store.int.spec.ts`: 10 request cùng lúc trên Postgres thật → 1 `started`, 9 `in_progress` |
| `pnpm test` không cần Docker, CI chạy test DB thật | Có | `vitest.config.ts` loại `*.int.spec.ts`; `.github/workflows/ci.yml` thêm `pnpm test:int` |

## Kết quả kiểm tra
Chạy ngày 2026-11-04, Windows 11, Docker Desktop 28.3.2, Node 24.22.1, pnpm 10.32.1:

```
pnpm lint                                        → 19/19 task pass; "Ranh giới module: không có vi phạm."
pnpm typecheck                                   → 19/19 task pass
pnpm test                                        → 69 test pass, 0 fail
                                                   db 4 (mới), idempotency 7 (mới), core-api 18, auth 14, storage 18,
                                                   notification-service 4, contracts 2, config 2
pnpm test:int                                    → 11 test pass, 0 fail: testing 3, idempotency 4, core-api 4 (~8–9 giây mỗi package)
pnpm build                                       → 12/12 task pass
pnpm turbo run lint typecheck test --affected    → 43/43 task pass
pnpm contracts:build                             → không đổi
```

Sau khi chạy `test:int` không còn container test nào (`docker ps -a`).

## Cách kiểm lại
1. `pnpm install`, bật Docker Desktop.
2. `pnpm test && pnpm test:int`.
3. App thật: `pnpm stack:infra && pnpm build`, chạy `node dist/main.js` trong `apps/core-api`, gọi `http://localhost:3000/health`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Cấu hình chung (Tech Lead): `pnpm-workspace.yaml` (catalog thêm 6 thư viện), `pnpm-lock.yaml`, `package.json` gốc (`test:int`), `turbo.json` (task `test:int`), `.github/workflows/ci.yml` (bước `pnpm test:int`). Chỉ thêm.
- `apps/core-api/src/platform/platform.module.ts`: `PlatformModule` vẫn export `CORE_ENV`, `DB_POOLS`, `REDIS` như cũ, thêm token Drizzle theo module. Module khác không phải sửa.
- Không đụng `content`, `commerce`, `discovery`, `analytics`. Thắng dùng `libs/idempotency` cho `commerce` theo README.
- pnpm báo "Ignored build scripts: cpu-features, protobufjs, ssh2" (phụ thuộc tuỳ chọn của testcontainers, chỉ cần khi nối Docker qua SSH).
