# TF051 — libs/outbox và access phát sự kiện

- Notion: <dán link task TF051> · Nhánh: `dung/TF051-libs-outbox` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- `libs/outbox` (mới):
  - `createOutboxTable(schema)`: bảng `<schema>.outbox_events`, index `idx_outbox_events_unpublished` chỉ gồm dòng chưa gửi.
  - `addOutboxEvent(tx, table, event, producer)`: tạo phong bì, kiểm bằng `eventEnvelopeSchema`, ghi bằng `tx` truyền vào để nằm chung transaction với thay đổi nghiệp vụ.
  - `OutboxRelay` + `DrizzleOutboxStore` / `MemoryOutboxStore`: giành lô bằng `locked_until` và `FOR UPDATE SKIP LOCKED` (commit ngay), `XADD` ngoài transaction, rồi ghi `published_at`. Lỗi thì giữ khoá để thử lại sau 30 giây; không giành sự kiện mới hơn sự kiện đang chờ, nên giữ thứ tự.
- `access`: bảng `access.outbox_events` (migration mới `add_outbox_events`, không sửa migration cũ); đăng ký ghi `access.user.registered` v1 (`{ userId, displayName }`, không có email) trong cùng transaction; relay `AccessOutboxRelay` gửi sang `stream:core.access` khi `APP_ROLE` là `worker` hoặc `all`.
- `libs/contracts`: `AccessUserRegisteredV1Schema`, xuất ra `contracts/events/access.user.registered.v1.schema.json`.
- README: `libs/outbox/README.md` (có ví dụ cho `content`), mục "Sự kiện phát ra" trong `access/README.md`.
- Tên bảng dùng `outbox_events` (số nhiều theo RULES §4.1); docs/10, docs/11 còn ghi `outbox`.
- Ngoài phạm vi (PR sau): `@Transactional` (đang truyền `tx` tay), dead-letter khi lỗi nhiều lần, job dọn dòng đã gửi, consumer ở `notification-service`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Module tạo được bảng outbox trong schema của mình | Có | `createOutboxTable(accessSchema)` → migration `20261104084357_add_outbox_events` tạo `access.outbox_events`, chủ là `tf_access` |
| Ghi sự kiện cùng transaction với thay đổi | Có | `register` gọi `tx.outbox.add` trong `store.transaction`; E2E kiểm đăng ký có đúng 1 sự kiện |
| Phong bì sự kiện đúng chuẩn `libs/contracts` | Có | `writer.spec.ts`: hợp lệ, từ chối `type` sai, từ chối `userId` không phải uuid |
| Relay gửi sang Redis Streams, gửi xong mới đánh dấu | Có | `relay.spec.ts`; kiểm tay (1) |
| Gửi lỗi thì thử lại, không mất, không đảo thứ tự | Có | `relay.spec.ts > gửi lỗi thì giữ sự kiện để thử lại...`; kiểm tay (3) |
| Nhiều relay không gửi trùng | Có | `relay.spec.ts > hai relay chạy cùng lúc...`; `FOR UPDATE SKIP LOCKED` trong bản Drizzle |
| Không gọi Redis trong transaction database (RULES §10) | Có | Relay giành dòng rồi commit, `XADD` sau đó (`store.ts`, `relay.ts`) |
| Phong dùng được cho `content` | Có | Ví dụ trong `libs/outbox/README.md` |

## Kết quả kiểm tra
Chạy ngày 2026-11-04, Node 24.22.1, pnpm 10.32.1:

```
pnpm lint                                        → 18/18 task pass; "Ranh giới module: không có vi phạm."
pnpm typecheck                                   → 18/18 task pass
pnpm test                                        → 65 test pass, 0 fail
                                                   outbox 7 (mới), core-api 18, auth 14, storage 18, notification-service 4, contracts 2, config 2
pnpm build                                       → 11/11 task pass
pnpm turbo run lint typecheck test --affected    → 40/40 task pass
pnpm contracts:build                             → thêm contracts/events/access.user.registered.v1.schema.json; OpenAPI không đổi
```

Kiểm tay trên Postgres 17 + Redis 8.8 local, `core-api` chạy `node dist/main.js` với `APP_ROLE=all`:

1. Đăng ký 3 tài khoản: `stream:core.access` từ 0 lên 3 sự kiện, đúng thứ tự Outbox 1 → 2 → 3; cả 3 dòng `access.outbox_events` có `published_at`, `attempts = 0`, đã mở khoá.
2. Dừng Redis, đăng ký 2 tài khoản, bật lại sau ~3 giây: ioredis giữ lệnh trong hàng đợi, gửi được ~2 giây sau khi Redis lên, đúng thứ tự A → B.
3. Dừng Redis ~25 giây, đăng ký C, D:
   - C: `attempts = 1`, còn khoá, `last_error = "Reached the max retries per request limit…"`; log có 1 dòng "Gửi sự kiện access lỗi, sẽ thử lại".
   - D (đến sau): **không** bị gửi vượt lên trước C.
   - Bật Redis: ~22 giây sau (hết khoá của C) gửi C rồi D, đúng thứ tự.
4. Tổng `XLEN stream:core.access = 7` = 7 lần đăng ký, không trùng.

## Cách kiểm lại
1. `pnpm install && pnpm stack:infra && pnpm build && pnpm db:migrate`.
2. Chạy `node dist/main.js` trong `apps/core-api` (cần `.env` từ `.env.example`, `APP_ROLE=all`).
3. `POST /api/auth/register` một tài khoản, rồi `docker exec tripflix-postgres-1 psql -U postgres -d core -c "select type, published_at from access.outbox_events"` và `docker exec tripflix-redis-1 redis-cli XRANGE stream:core.access - +`.
4. `pnpm --filter @tripflix/outbox test`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không đụng code của module khác. `content` (Phong, Thành, Trang) tự thêm `content.outbox_events` và relay theo `libs/outbox/README.md`.
- `pnpm-lock.yaml`: chỉ thêm liên kết workspace `@tripflix/outbox`, không thêm thư viện ngoài.
- `contracts/events/`: thêm file schema mới, không đổi file cũ.
