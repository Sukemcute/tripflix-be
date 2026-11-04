# TF053 — access dùng @Transactional và OutboxWriter

- Notion: <dán link task TF053> · Nhánh: `dung/TF053-access-transactional-outbox-writer` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- `libs/outbox`: `OutboxWriter(getExecutor, table, producer).add(event)`, ghi sự kiện bằng transaction đang mở, không cần truyền `tx`; `deletePublishedBefore(db, table, date)` cho job dọn bảng. `addOutboxEvent(tx, …)` cũ giữ nguyên.
- `libs/db`: `buildTransactionHostToken(module)` (inject `TransactionHost` vào provider factory), `createNoOpTransactionalPlugins()` (test với store bộ nhớ).
- `access`:
  - `AuthUseCases` tách các bước ghi database thành hàm nhỏ có `@Transactional('access')`: `createMember`, `openSession`, `revokeReusedSession`, `rotateSession`, `closeSession`. Băm argon2, Redis, ký token chạy ngoài transaction.
  - `DrizzleAccessStore(() => db)`: repository lấy executor cho từng lệnh; Nest truyền `() => txHost.tx`, seed CLI truyền `() => db`. Bỏ `AccessStore.transaction()`.
  - `outbox` của store là `OutboxWriter`.
- README `libs/db`, `libs/outbox`, `access` có mẫu thật từ `access`.
- Không đổi API, sự kiện, bảng.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Use case `access` dùng `@Transactional('access')` | Có | `auth.use-cases.ts` |
| Ghi lỗi giữa chừng thì rollback cả thay đổi | Có | `auth.use-cases.int.spec.ts > ghi outbox lỗi thì rollback cả user` (Postgres thật: 0 user, 0 outbox) |
| User và sự kiện cùng commit | Có | `auth.use-cases.int.spec.ts > đăng ký: user và sự kiện outbox cùng được commit` |
| Relay gửi sự kiện sang Redis thật, đánh dấu đã gửi | Có | `auth.use-cases.int.spec.ts > relay đưa sự kiện…` (Redis container, `XRANGE`) |
| `OutboxWriter` không cần truyền `tx` | Có | `DrizzleAccessStore.outbox` là `OutboxWriter`; các test trên |
| Dọn dòng đã gửi đúng | Có | `auth.use-cases.int.spec.ts > deletePublishedBefore chỉ xoá dòng đã gửi trước mốc` |
| 18 test cũ của core-api vẫn pass | Có | `pnpm test`: core-api 18/18 |
| README `libs/db` có mẫu từ `access` | Có | `libs/db/README.md` |

## Kết quả kiểm tra
Chạy ngày 2026-11-04, Node 24.22.1, pnpm 10.32.1, Docker Desktop 28.3.2:

```
pnpm lint          → 21/21 task pass; "Ranh giới module: không có vi phạm."
pnpm typecheck     → 21/21 task pass
pnpm test          → 76 test pass, 0 fail (core-api 18, auth 14, storage 18, outbox 7, idempotency 7, db 4, notification-service 4, contracts 2, config 2)
pnpm test:int      → 14 test pass, 0 fail (core-api 7: 3 cũ + 4 mới; idempotency 4; testing 3)
pnpm build         → 13/13 task pass
pnpm contracts:build → không đổi
```

Kiểm tay: `core-api` chạy `node dist/main.js` trên Postgres, Redis local. Đăng ký `201`, đăng ký trùng `409`, đăng nhập, làm mới `200`, `/auth/me` `200`; `stream:core.access` tăng 7 → 8; `access.audit_logs` có `auth.register`, `auth.login`, `auth.refresh`; log không có lỗi.

## Cách kiểm lại
1. `pnpm install`, bật Docker Desktop.
2. `pnpm test && pnpm test:int`.
3. `pnpm stack:infra && pnpm build && pnpm db:migrate`, chạy `node dist/main.js` trong `apps/core-api`, gọi `POST /api/auth/register`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `libs/db`, `libs/outbox` (thêm hàm, không đổi hàm cũ) và module `access`.
