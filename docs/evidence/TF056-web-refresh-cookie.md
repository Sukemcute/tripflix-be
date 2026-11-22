# TF056 — Cookie refresh token cho web và admin

- Notion: <dán link task TF056> · Nhánh: `dung/TF056-web-refresh-cookie` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- Chế độ web: client gửi header `X-Tripflix-Client: web`.
  - `POST /api/auth/login`, `/refresh` đặt cookie `tripflix_refresh` (`HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Max-Age` 30 ngày, `Secure` khi `NODE_ENV=production`) và **không** trả `refreshToken` trong body.
  - `/refresh` đọc token từ body, không có thì đọc cookie; body trống hoặc không gửi body đều được. Làm mới lỗi ở chế độ web thì xoá cookie.
  - `/logout`, `/logout-all` xoá cookie.
- Chống CSRF: mọi request ở chế độ web hoặc có dùng cookie phải có `Origin` nằm trong `AUTH_WEB_ORIGINS`; thiếu hoặc lạ: `403 "Nguồn gửi request không được phép"`. Kiểm trước khi đăng nhập, nên origin lạ không tạo phiên và không bị tính lần đăng nhập sai.
- CORS: `platform/http.ts` thêm `applyCors`, chỉ cho origin trong `AUTH_WEB_ORIGINS`, có `credentials`. Traefik chưa có CORS nên bật ở core-api.
- Biến mới `AUTH_WEB_ORIGINS` (mặc định `http://localhost:3100,http://localhost:3200`), kiểm từng phần tử phải là origin đầy đủ. Thêm vào `.env.example`, `deploy/compose.yaml`.
- `readCookie(header, name)` tự viết trong `auth/api/web-session.ts`, không thêm `cookie-parser`.
- App mobile không đổi: không gửi header thì vẫn nhận và gửi `refreshToken` trong body, không có cookie, không cần `Origin`.
- README `access`: mục "Web, admin: refresh token trong cookie", biến `AUTH_WEB_ORIGINS`.
- Không có migration mới, không thêm thư viện.

## Đổi hợp đồng API (cần báo Trang)
- `TokenPairDto.refreshToken` và `RefreshDto.refreshToken` chuyển từ bắt buộc sang không bắt buộc (`refreshToken?: string`), vì chế độ web không trả trường này. App mobile vẫn luôn nhận được; sau `pnpm gen:api` chỉ cần kiểm có giá trị trước khi lưu.
- Thêm header `X-Tripflix-Client` (không bắt buộc) và phản hồi `403` cho `login`, `refresh`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| E2E kiểm cookie `HttpOnly` | Có | `web-cookie.e2e.spec.ts > đăng nhập web: cookie HttpOnly…`; `web-session.spec.ts > production bật Secure`; kiểm tay (4) |
| Body không có `refreshToken` | Có | `web-cookie.e2e.spec.ts` (đăng nhập, làm mới); kiểm tay (3), (7) |
| `Origin` lạ nhận `403` | Có | `web-cookie.e2e.spec.ts > đăng nhập web với Origin lạ…`, `> CSRF…`; kiểm tay (5), (6) |
| Mobile không bị ảnh hưởng | Có | `web-cookie.e2e.spec.ts > app mobile không đổi…`; mọi E2E cũ (`auth`, `account`, `staff`, media) vẫn pass; kiểm tay (11) |

## Kết quả kiểm tra
Chạy ngày 2026-11-05, Node 24.22.1, pnpm 10.32.1, Docker Desktop 28.3.2:

```
pnpm lint          → 22/22 task pass; "Ranh giới module: không có vi phạm."
pnpm typecheck     → 22/22 task pass
pnpm test          → 207 test pass, 0 fail (core-api 149: thêm 9 E2E cookie, 7 unit readCookie/WebSession, 3 unit AUTH_WEB_ORIGINS)
pnpm test:int      → 19 test pass, 0 fail (core-api 12, idempotency 4, testing 3); TF056 không đổi database
pnpm build         → 13/13 task pass
pnpm contracts:build → OpenAPI: header X-Tripflix-Client, phản hồi 403 cho login/refresh, refreshToken không bắt buộc
```

Kiểm tay trên `core-api` với Postgres, Redis local (gửi `Origin`, `Cookie` như trình duyệt): **11/11 PASS**.

```
(1)  CORS preflight từ web 3100 → cho phép kèm cookie (204)
(2)  CORS preflight từ origin lạ → không có Access-Control-Allow-Origin
(3)  đăng nhập web → 200, body không có refreshToken
(4)  Set-Cookie: tripflix_refresh=…; Max-Age=2592000; Path=/api/auth; HttpOnly; SameSite=Lax
(5)  đăng nhập web từ origin lạ → 403 "Nguồn gửi request không được phép"
(6)  CSRF: origin lạ gửi kèm cookie → 403
(7)  làm mới bằng cookie, body trống → 200, cookie mới, body không có refreshToken
(8)  access token mới dùng được → 200
(9)  đăng xuất web → 204, xoá cookie
(10) cookie cũ sau đăng xuất → 401 và bị xoá
(11) app mobile không đổi: refreshToken trong body, không Set-Cookie
```

## Cách kiểm lại
1. `pnpm install && pnpm stack:infra && pnpm build && pnpm db:migrate`.
2. Chạy `node dist/main.js` trong `apps/core-api`.
3. Từ trang web chạy ở `http://localhost:3100`: `fetch('http://localhost:8080/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Tripflix-Client': 'web' }, body: … })`, rồi `refresh` với body trống.
4. `pnpm test && pnpm test:int`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không đụng code của người khác. `platform/http.ts`, `platform/env.ts` (CODEOWNERS: Dũng) và `main.ts` thêm CORS, biến `AUTH_WEB_ORIGINS`; `deploy/compose.yaml` thêm biến này.
- `contracts/`: `refreshToken` không bắt buộc (xem "Đổi hợp đồng API"). Thành (web), Trang (admin, mobile) chạy `pnpm gen:api`.
