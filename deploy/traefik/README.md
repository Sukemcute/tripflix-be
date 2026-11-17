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

## Access log trên server

`compose.server.yaml` bật access log JSON ra stdout: mỗi request một dòng có IP, đường dẫn, mã trả về, thời gian xử lý. Không ghi header nên không lộ token, cookie.

- Log có IP người dùng: chỉ xem nội bộ, không chép ra ngoài.
- Giữ khoảng 30 MB xoay vòng (logging json-file 10 MB × 3).
- `/dat-lai-mat-khau`, `/xac-thuc-email` (link email mang `?token=`) không ghi log: router `web-token-links` trong `server.yml`.
- Xem: `dc logs -f --tail 50 traefik`.

## Rate limit theo IP

| Middleware | Áp cho | Giới hạn mỗi IP |
|---|---|---|
| `rate-limit-auth` | `POST /api/auth/login`, `/register`, `/google`, `/password/forgot`, `/password/reset`, `/service-token` | Trung bình 30 request/phút, dồn tối đa 10 |
| `rate-limit-chat` | `POST /ai/chat` (trợ lý Tripi) | Trung bình 20 request/phút, dồn tối đa 5 |
| `rate-limit-api` | Mọi đường còn lại | Trung bình 50 request/giây, dồn tối đa 100 |

- Vượt giới hạn: gateway trả `429` ngay, request không tới service.
- Mỗi router đếm riêng: `rate-limit-api` của `/api` và của `/ai` là hai bộ đếm khác nhau.
- `rate-limit-chat` chỉ chặn dồn dập theo IP. Hạn mức theo người dùng (lượt/phút, lượt và token/ngày, khách ít hơn) nằm trong ai-service, trả `429` kèm `Retry-After`.
- Bộ đếm nằm trong bộ nhớ Traefik: đủ cho một gateway. Chạy nhiều bản Traefik thì cần bộ đếm chung (tuỳ chọn `redis` của `rateLimit`).
- IP lấy từ kết nối tới Traefik. Khi đặt Traefik sau load balancer, CDN: thêm `sourceCriterion.ipStrategy.depth: 1` cho hai middleware và `--entrypoints.web.forwardedHeaders.trustedIPs=<dải IP của load balancer>`, nếu không mọi người dùng sẽ chung IP của load balancer.

Giới hạn theo tài khoản nằm trong module `access` (Redis): đăng nhập sai 5 lần theo email, quên mật khẩu 3 lần mỗi giờ, xin token service sai 5 lần theo client. Gateway chỉ chặn dồn dập theo IP trước khi tới service.

## Kiểm JWT

Gateway không kiểm token. `core-api`, `notification-service` tự kiểm chữ ký bằng `@tripflix/auth` qua JWKS, nên request đi thẳng vào service trong mạng nội bộ cũng bị kiểm như nhau.
