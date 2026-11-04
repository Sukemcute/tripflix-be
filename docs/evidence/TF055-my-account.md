# TF055 — Tài khoản của tôi

- Notion: <dán link task TF055> · Nhánh: `dung/TF055-my-account` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- Phần con mới `access/account/` (cùng khuôn `api/ application/`), mọi API cần access token:
  - `PATCH /api/auth/me { displayName }`: đổi tên hiển thị.
  - `POST /api/auth/password/change { currentPassword, newPassword }`: `204`; thu hồi mọi phiên khác, giữ phiên đang gọi.
  - `GET /api/auth/sessions`: `{ id, deviceName, userAgent, createdAt, lastUsedAt, isCurrent }`, chỉ phiên còn hạn.
  - `DELETE /api/auth/sessions/{sessionId}`: `204`; phiên không phải của mình `404`.
  - `POST /api/auth/logout-all`: `204`; thoát mọi thiết bị, kể cả thiết bị đang gọi.
- Xoá phiên nằm trong `@Transactional('access')` cùng `audit_logs`; sau commit mới chặn `sid` trong Redis, token cũ nhận `401` ngay.
- Sai mật khẩu hiện tại trả `400 "Mật khẩu hiện tại không đúng"`, không dùng `401` như kế hoạch ban đầu: client hiểu `401` là token hết hạn, sẽ tự làm mới hoặc đăng xuất người dùng. Lần sai tính chung vào giới hạn đăng nhập sai của email (5 lần trong 15 phút rồi `429`), để ai cầm được access token cũng không dò được mật khẩu.
- Sự kiện mới `access.user.profile_updated` v1 `{ userId, displayName }`: `access.user.registered` đã mang `displayName`, module nào lưu tên thì cần biết khi tên đổi. Gửi lại cùng tên thì không phát.
- Audit mới: `auth.profile_updated`, `auth.password_changed`, `auth.password_change_failed`, `auth.session_revoked`, `auth.logout_all`.
- Job dọn `auth/jobs/access-cleanup.job.ts` (khi `APP_ROLE` là `worker` hoặc `all`, lúc khởi động rồi mỗi 24 giờ, `setInterval`): xoá phiên hết hạn, xoá `access.outbox_events` đã gửi quá 7 ngày (`deletePublishedBefore` của `libs/outbox`).
- Repository: `users.updateDisplayName`, `users.updatePasswordHash`, `sessions.listActiveByUser`, `sessions.deleteOwned`, `sessions.deleteExpired`, `sessions.deleteByUser(userId, exceptId?)` (bản Drizzle và bản bộ nhớ).
- README `access`: API, audit, sự kiện, mục "Job dọn dẹp".
- Không có migration mới, không thêm thư viện.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Thoát một máy thì token máy đó nhận `401`, máy khác vẫn dùng được | Có | `account.e2e.spec.ts > thoát một thiết bị…`; kiểm tay (3)–(6) |
| Đổi mật khẩu thì máy khác bị đăng xuất | Có | `account.e2e.spec.ts > đổi mật khẩu…`; kiểm tay (8)–(12) |
| Xoá phiên của người khác nhận `404` | Có | `account.e2e.spec.ts`; `drizzle-access.store.int.spec.ts > deleteOwned chỉ xoá phiên của đúng người` |
| `logout-all` đăng xuất mọi máy | Có | `account.e2e.spec.ts > POST /auth/logout-all…`; kiểm tay (13), (14) |
| Job dọn đúng dòng (test DB thật) | Có | `drizzle-access.store.int.spec.ts > job dọn…`: xoá phiên hết hạn và sự kiện gửi quá 7 ngày; giữ phiên còn hạn, sự kiện gửi 1 ngày trước và sự kiện chưa gửi; chạy lại không xoá thêm. Log khi khởi động: `"expiredSessions":0,"publishedEvents":0` |

## Kết quả kiểm tra
Chạy ngày 2026-11-04, Node 24.22.1, pnpm 10.32.1, Docker Desktop 28.3.2:

```
pnpm lint          → ESLint 22/22 task pass; kiểm ranh giới báo 4 vi phạm, đều ở
                     content/media/media-upload.e2e.spec.ts (của Phong, đã có trên develop
                     từ PR #14). TF055 không thêm vi phạm nào.
pnpm typecheck     → 22/22 task pass
pnpm test          → 128 test pass, 0 fail (core-api 70: thêm 6 E2E)
pnpm test:int      → 19 test pass, 0 fail (core-api 12: thêm 3 ca TF055, idempotency 4, testing 3)
pnpm build         → 13/13 task pass
pnpm contracts:build → thêm contracts/events/access.user.profile_updated.v1.schema.json,
                     OpenAPI thêm PATCH /auth/me, /auth/password/change, /auth/sessions,
                     DELETE /auth/sessions/{sessionId}, /auth/logout-all
```

Kiểm tay trên `core-api` với Postgres, Redis local: **14/14 PASS**.

```
(1)  PATCH /auth/me đổi tên → 200
(2)  GET /auth/sessions có 3 thiết bị, đúng 1 isCurrent (iPad, MacBook, Pixel 8*)
(3)  thoát MacBook → 204
(4)  token MacBook bị chặn ngay → 401
(5)  refresh token MacBook → 401
(6)  Pixel 8 vẫn dùng được → 200
(7)  đổi mật khẩu, sai mật khẩu cũ → 400 "Mật khẩu hiện tại không đúng"
(8)  đổi mật khẩu → 204
(9)  iPad bị đăng xuất → 401
(10) Pixel 8 dùng tiếp → 200
(11) đăng nhập mật khẩu cũ → 401
(12) đăng nhập mật khẩu mới → 200
(13) logout-all → 204
(14) Pixel 8 và MacBook đều 401
```

Trong database sau khi chạy: `audit_logs` của người thử có `auth.profile_updated`, `auth.session_revoked`, `auth.password_change_failed`, `auth.password_changed`, `auth.logout_all`; `outbox_events` có `access.user.registered`, `access.user.profile_updated`, cả hai đã có `published_at` và nằm trong `stream:core.access`; không còn phiên nào của người thử.

## Cách kiểm lại
1. `pnpm install && pnpm stack:infra && pnpm build && pnpm db:migrate`.
2. Chạy `node dist/main.js` trong `apps/core-api`.
3. Đăng ký, đăng nhập 2 lần với `deviceName` khác nhau, gọi các API trên Swagger `http://localhost:3000/docs`.
4. `pnpm test && pnpm test:int`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không đụng code module khác.
- `contracts/`: chỉ thêm endpoint và sự kiện. Trang (mobile), Thành (web) dùng API mới sau khi chạy `pnpm gen:api`.
