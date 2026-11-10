# TF26A — WebSocket /ws trong notification-service

- Jira: [SCRUM-76](https://tripflix.atlassian.net/browse/SCRUM-76) (thuộc TF26, SCRUM-30) · Nhánh: `dung/TF26A-websocket` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-10

## Đã làm
- `notification-service` mở kênh realtime `/ws` bằng Socket.IO (`@nestjs/websockets`, `@nestjs/platform-socket.io` 12.3.2 cùng bản với `@nestjs/core`). Chỉ transport `websocket`: không long-polling nên chạy nhiều replica không cần sticky session ở traefik.
- Redis adapter (`@socket.io/redis-adapter`, pub/sub, hai kết nối riêng tách từ `REDIS_URL`): replica nào phát thì socket ở replica khác cũng nhận. Redis chưa lên lúc khởi động thì service vẫn chạy, ioredis tự kết nối lại.
- Bắt tay (`src/realtime/handshake-auth.ts`): token trong `auth.token` (nhận cả `Bearer <token>`), kiểm như `AccessTokenGuard` của HTTP: chữ ký qua JWKS, `iss`, `aud`, `exp`, sid chưa bị thu hồi. Sai thì `connect_error` với `data.code = 'unauthorized'`; Redis hoặc JWKS lỗi thì `'unavailable'` (không cho qua khi chưa kiểm được phiên).
- Room do server tự gán từ token: `user:<userId>`, `sid:<sid>`. Không có `@SubscribeMessage` nào, client không tự vào room được.
- Token hết hạn trong lúc đang mở: tới `exp` server gửi `auth.expired` rồi ngắt.
- `RealtimeService`: `emitToUser`, `disconnectUser`, `disconnectSession`, dùng được qua mọi replica. TF26B, TF46 sẽ gọi qua đây.
- Consumer: `access.user.locked` và `access.user.role_changed` (access đã thu hồi mọi phiên) thì ngắt mọi kết nối `/ws` của người đó ngay, không chờ token hết hạn.
- `/health` có thêm `checks.realtime` (kết nối pub/sub của adapter).
- README `notification-service`: mục WebSocket kèm ví dụ client. Không có migration, không đổi contracts. Gateway (`deploy/traefik/dynamic.yml`) đã có route `/ws` từ trước, không sửa.

## Đối chiếu "Xong khi" (SCRUM-76)
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Token hợp lệ kết nối được qua gateway `/ws`; không token bị từ chối | Có | Kiểm thật qua traefik `:8080` (1), (3); `realtime.e2e.spec.ts` |
| 2 replica: phát ở A, client ở B vẫn nhận | Có | `realtime.int.spec.ts` (Redis thật, 2 instance AppModule) |
| Test e2e bắt tay và phát theo room | Có | `realtime.e2e.spec.ts` 13 test, `handshake-auth.spec.ts` 8 test |

Case lỗi đã chặn (bản đồ notification): E1 (client xin vào room người khác), E2 (token hết hạn khi socket còn mở), E3 (bị khoá, đổi vai trò mà vẫn nhận tin), E6 (chỉ websocket, ping mặc định 25 giây), E7 (`/health` báo khi pub/sub mất).

## Kết quả kiểm tra
Chạy ngày 2026-11-10, Node 24.22.1, pnpm 10.32.1, Docker 28.3.2:

```
notification-service
  pnpm typecheck  → pass
  pnpm lint       → pass (oxlint --type-aware)
  pnpm test       → 10 file, 73 test pass (thêm 24: handshake-auth 8, disconnect-revoked-user 3, realtime.e2e 13)
  pnpm test:int   → 2 file, 4 test pass (thêm realtime.int 3: pub/sub sẵn sàng, phát A → client B, ngắt A → client B)
```

Kiểm thật qua gateway traefik local `:8080` với token thật của core-api (đăng nhập `member@tripflix.local`): **5/5 PASS**.

```
(1) thiếu token: connect_error, code "unauthorized"
(2) long-polling: bị từ chối
(3) token thật: kết nối được, transport "websocket" (traefik upgrade được)
(4) superadmin khoá member: socket bị ngắt "io server disconnect" sau 201 ms
    (core outbox → stream:core.access → consumer notification → /ws)
(5) kết nối lại bằng token cũ: "unauthorized" (sid đã bị thu hồi)
    Sau đó mở khoá lại member (status active).
```

## Cách kiểm lại
1. `pnpm install && pnpm stack:infra && pnpm build && pnpm db:migrate`; chạy `node dist/main.js` trong `apps/core-api` và `apps/notification-service`.
2. `pnpm --filter @tripflix/notification-service test` và `test:int` (cần Docker).
3. Client thử: xem ví dụ trong `apps/notification-service/README.md`, mục WebSocket; đăng nhập lấy `accessToken` từ `POST /api/auth/login` rồi `io('http://localhost:8080', { path: '/ws', transports: ['websocket'], auth: { token } })`.

## Ảnh hưởng tới phần của người khác
- Chỉ sửa `notification-service` và thêm thư viện vào catalog (`pnpm-workspace.yaml`, lockfile). Không đụng module của người khác.
- FE (Thành) chưa cần làm gì ở task này; nối client ở TF26B và TF46L.
