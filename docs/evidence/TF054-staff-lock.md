# TF054 — Quản lý nhân viên và khoá tài khoản

- Notion: <dán link task TF054> · Nhánh: `dung/TF054-staff-lock` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- API Back Office:
  - `GET /api/admin/users?query=&page=` (`moderator`, `superadmin`): 20 người mỗi trang; moderator thấy email đã che.
  - `POST /api/admin/staff { userId }`, `DELETE /api/admin/staff/{userId}` (`superadmin`): cấp, thu hồi `moderator`.
  - `POST /api/admin/users/{userId}/lock`, `/unlock` (`superadmin`).
- Quy tắc `staff/domain/staff-policy.ts`: không tự đổi quyền hay khoá mình; không đổi quyền hay khoá superadmin; chỉ cấp quyền cho tài khoản đang hoạt động. Vi phạm trả `409` kèm lý do tiếng Việt.
- Đổi quyền hoặc khoá: trong `@Transactional('access')` đổi `users`, xoá mọi phiên, ghi `audit_logs`, ghi outbox; sau commit chặn từng `sid` trong Redis.
- Sự kiện mới (schema trong `libs/contracts`, file trong `contracts/events/`): `access.user.role_changed` v1, `access.user.locked` v1, `access.user.unlocked` v1.
- Repository: `users.search`, `users.updateRole`, `users.updateStatus`, `sessions.deleteByUser` (bản Drizzle và bản bộ nhớ). Tìm kiếm thoát `% _ \` trong từ khoá.
- README `access`: API, sự kiện, mục "Quản lý nhân viên".

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| `moderator` gọi `POST /admin/staff` nhận `403` | Có | `staff.e2e.spec.ts`; kiểm tay (3) |
| Bị khoá thì access token cũ nhận `401`, đăng nhập nhận lỗi chung | Có | `staff.e2e.spec.ts > khoá tài khoản…`; kiểm tay (9), (10) |
| Cấp quyền xong, đăng nhập lại thì token mang `role=moderator` | Có | `staff.e2e.spec.ts > … đăng nhập lại có role mới`; kiểm tay (5), (6) |
| Không hạ quyền được superadmin; không tự khoá mình | Có | `staff-policy.spec.ts`; `staff.e2e.spec.ts > quy tắc…`; kiểm tay (7) |
| Moderator thấy email đã che | Có | `staff.e2e.spec.ts`; kiểm tay (2): `tf***@example.com` |
| Có sự kiện và audit | Có | E2E kiểm payload `role_changed`, `locked`, `unlocked`; DB thật: 5 sự kiện của người thử đều có `published_at`, `audit_logs` có `staff.role_granted`, `user.locked`, `user.unlocked`, `staff.role_revoked` |
| Có E2E và test DB thật | Có | `staff.e2e.spec.ts` (5 ca), `drizzle-access.store.int.spec.ts` (thêm 2 ca: tìm kiếm có thoát `%`, đổi quyền và xoá mọi phiên) |

## Kết quả kiểm tra
Chạy ngày 2026-11-04, Node 24.22.1, pnpm 10.32.1, Docker Desktop 28.3.2:

```
pnpm lint          → 21/21 task pass; "Ranh giới module: không có vi phạm."
pnpm typecheck     → 21/21 task pass
pnpm test          → 86 test pass, 0 fail (core-api 28: thêm 5 quy tắc + 5 E2E)
pnpm test:int      → 16 test pass, 0 fail (core-api 9, idempotency 4, testing 3)
pnpm build         → 13/13 task pass
pnpm contracts:build → thêm 3 file contracts/events, OpenAPI thêm 5 endpoint /api/admin/*
```

Kiểm tay trên `core-api` với Postgres, Redis local và tài khoản seed: **13/13 PASS**.

```
(1)  superadmin tìm người dùng thấy email đầy đủ
(2)  moderator thấy email đã che (tf***@example.com)
(3)  moderator cấp quyền → 403
(4)  superadmin cấp moderator → 200
(5)  token cũ của người được cấp quyền bị chặn ngay → 401
(6)  đăng nhập lại: token mang role moderator
(7)  superadmin tự khoá mình → 409 "Không thể tự đổi quyền hoặc khoá tài khoản của chính mình"
(8)  khoá tài khoản → 200 locked
(9)  token sau khi bị khoá → 401
(10) đăng nhập khi bị khoá → 401 "Email hoặc mật khẩu không đúng"
(11) mở khoá → 200 active
(12) đăng nhập lại sau mở khoá → 200
(13) thu hồi quyền → member
```

## Cách kiểm lại
1. `pnpm install && pnpm stack:infra && pnpm build && pnpm db:migrate && pnpm db:seed`.
2. Chạy `node dist/main.js` trong `apps/core-api`.
3. Đăng nhập `superadmin@tripflix.local` / `SEED_PASSWORD`, gọi `GET /api/admin/users`, `POST /api/admin/staff` trên Swagger `http://localhost:3000/docs`.
4. `pnpm test && pnpm test:int`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không đụng code module khác.
- `contracts/`: chỉ thêm endpoint và sự kiện. Trang (admin) dùng API `/api/admin/*` mới sau khi chạy `pnpm gen:api`.
