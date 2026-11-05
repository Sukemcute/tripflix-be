# Gateway Traefik

- Phụ trách: Dũng
- Chạy cùng `pnpm stack:be` hoặc `pnpm stack:up` (profile `gateway`): http://localhost:8080, dashboard http://localhost:8081.
- Cấu hình trong `dynamic.yml`; Traefik tự nạp lại khi file đổi.

## Đường đi

| Đường dẫn | Tới |
|---|---|
| `/api/*` | `core-api:3000` |
| `/notifications/*`, `/ws` | `notification-service:3001` |
| `/ai/*` | `ai-service:8000` |

`/.well-known/jwks.json` không đi qua gateway: service khác gọi thẳng `core-api` trong mạng nội bộ.

## Rate limit theo IP

| Middleware | Áp cho | Giới hạn mỗi IP |
|---|---|---|
| `rate-limit-auth` | `POST /api/auth/login`, `/register`, `/google`, `/password/forgot`, `/password/reset`, `/service-token` | Trung bình 30 request/phút, dồn tối đa 10 |
| `rate-limit-api` | Mọi đường còn lại | Trung bình 50 request/giây, dồn tối đa 100 |

- Vượt giới hạn: gateway trả `429` ngay, request không tới service.
- Mỗi router đếm riêng: `rate-limit-api` của `/api` và của `/ai` là hai bộ đếm khác nhau.
- Bộ đếm nằm trong bộ nhớ Traefik: đủ cho một gateway. Chạy nhiều bản Traefik thì cần bộ đếm chung (tuỳ chọn `redis` của `rateLimit`).
- IP lấy từ kết nối tới Traefik. Khi đặt Traefik sau load balancer, CDN: thêm `sourceCriterion.ipStrategy.depth: 1` cho hai middleware và `--entrypoints.web.forwardedHeaders.trustedIPs=<dải IP của load balancer>`, nếu không mọi người dùng sẽ chung IP của load balancer.

Giới hạn theo tài khoản nằm trong module `access` (Redis): đăng nhập sai 5 lần theo email, quên mật khẩu 3 lần mỗi giờ, xin token service sai 5 lần theo client. Gateway chỉ chặn dồn dập theo IP trước khi tới service.

## Kiểm JWT

Gateway không kiểm token. `core-api`, `notification-service` tự kiểm chữ ký bằng `@tripflix/auth` qua JWKS, nên request đi thẳng vào service trong mạng nội bộ cũng bị kiểm như nhau.
