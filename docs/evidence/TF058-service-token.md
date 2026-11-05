# TF058 — Token giữa các service

- Notion: <dán link task TF058> · Nhánh: `dung/TF058-service-token` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- `libs/auth`: `createServiceTokenVerifier`, `ServiceTokenGuard`, `@ServiceOnly(...clientIds)`, `@CurrentService()`; `AuthModule.forRootAsync` nhận thêm `serviceVerifier` (không bắt buộc). Token người dùng bị từ chối ở guard service vì không có `typ=service`; token service bị từ chối ở `AccessTokenGuard` vì không có `role`, `sid` và `aud` khác.
- Bảng `access.service_clients` (migration mới `20261105025633_add_service_clients`): `client_id` (khoá chính), `secret_hash` (argon2), `allowed_audiences text[]`, `created_at`, `disabled_at`; ràng buộc `ck_service_clients_client_id_format`, `ck_service_clients_allowed_audiences_not_empty`.
- CLI `pnpm --filter @tripflix/core-api auth:create-service-client <clientId> <audience...>` (in secret 256 bit đúng một lần) và `auth:disable-service-client <clientId>`. Từ chối `aud` trùng `AUTH_JWT_AUDIENCE` và tên sai dạng.
- `POST /api/auth/service-token { clientId, clientSecret, audience }`: JWT ES256 `{ sub: clientId, typ: 'service', aud, iss }`, sống 5 phút. Sai bất kỳ thông tin nào: `401 "Thông tin service không đúng"`, lý do thật ghi `audit_logs` (`service.token_failed`, `meta.reason`). Client không tồn tại vẫn chạy argon2. Rate limit dùng chung bộ đếm đăng nhập sai (5 lần theo client, 20 lần theo IP / 15 phút).
- core-api nhận token service `aud=core-api` ở API nội bộ có `@ServiceOnly` (cấu hình `serviceVerifier` trong `AccessModule`).
- README `access` (mục "Token giữa các service", ví dụ Python cho `ai-service`), README `libs/auth` (mục "Token service").
- Không thêm thư viện (`libs/auth` chỉ thêm devDependency có sẵn trong catalog để test).

## Khác kế hoạch
- Token người dùng gọi API `@ServiceOnly` nhận `401`, không phải `403` như kế hoạch: với guard service, token người dùng là token không hợp lệ (sai `aud`, thiếu `typ`). `403` dành cho token service hợp lệ nhưng client không nằm trong `@ServiceOnly(...)`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| E2E cấp token rồi gọi controller có `@ServiceOnly` | Có | `service-token.e2e.spec.ts > gọi API @ServiceOnly…`: đúng client `200`, client khác `403`, `@ServiceOnly()` mọi service `200` |
| Token người dùng bị từ chối ở đó | Có (`401`, xem trên) | `service-token.e2e.spec.ts > token người dùng bị từ chối ở API service…` |
| Client bị vô hiệu hoá nhận `401` | Có | `service-token.e2e.spec.ts > client bị vô hiệu hoá…`; kiểm tay (10) |
| Tài liệu cho Bảo | Có | README `access`, mục "Token giữa các service" (ví dụ Python dùng `httpx`, xin lại trước khi hết hạn) |

## Kết quả kiểm tra
Chạy ngày 2026-11-05, Node 24.22.1, pnpm 10.32.1, Docker Desktop 28.3.2, sau khi gộp `develop` mới nhất:

```
pnpm lint          → 22/22 task pass; "Ranh giới module: không có vi phạm."
pnpm typecheck     → 22/22 task pass
pnpm test          → 280 test pass, 0 fail (core-api 216: thêm 8 E2E token service, 3 unit quy tắc tên; auth 18: thêm 4 unit token service)
pnpm test:int      → 26 test pass, 0 fail (core-api 19: thêm 2 ca service_clients; idempotency 4, testing 3)
pnpm build         → 13/13 task pass
pnpm contracts:build → OpenAPI thêm POST /api/auth/service-token
pnpm db:migrate    → access: đã migrate (bảng service_clients)
```

Kiểm tay trên `core-api` với Postgres, Redis local; client tạo bằng CLI thật, secret truyền qua biến môi trường, không in ra: **10/10 PASS**.

```
(1)  xin token đúng → 200, expiresIn 300
(2)  claim: typ=service, sub=clientId, aud=core-api, không role, sid
(3)  kiểm chữ ký qua /.well-known/jwks.json bằng createServiceTokenVerifier như service khác → hợp lệ
(4)  service khác (aud=notification-service) kiểm token này → InvalidServiceTokenError
(5)  token service gọi API người dùng /auth/me → 401
(6)  xin token cho notification-service (được phép) → 200, aud đúng
(7)  aud không được phép → 401 "Thông tin service không đúng"
(8)  sai secret → 401 thông báo chung
(9)  client không có → 401 thông báo chung
(10) client đã vô hiệu hoá → 401
```

CLI: tạo client in `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET`; tên sai dạng và vô hiệu hoá client không có đều thoát mã 1 kèm lý do. Trong database: `secret_hash` dạng `$argon2id$`, `audit_logs` có `service.client_created`, `service.client_disabled`, `service.token_failed` với `reason` `audience_not_allowed`, `wrong_secret`, `unknown_client`. Hai client thử đã vô hiệu hoá sau khi kiểm.

## Cách kiểm lại
1. `pnpm install && pnpm stack:infra && pnpm build && pnpm db:migrate`.
2. `pnpm --filter @tripflix/core-api auth:create-service-client ai-service core-api`, giữ secret in ra.
3. Chạy `node dist/main.js` trong `apps/core-api`, gọi `POST /api/auth/service-token` trên Swagger `http://localhost:3000/docs`.
4. `pnpm test && pnpm test:int`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không đụng code của người khác (`libs/auth`, `access`, `contracts/` đều thuộc Dũng).
- `contracts/`: chỉ thêm endpoint. Bảo (`ai-service`) theo README `access` để xin token; khi cần API nội bộ ở core-api thì báo Dũng tạo client và thêm `@ServiceOnly`.
