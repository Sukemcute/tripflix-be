# TF05A — Rate limit ở gateway Traefik

- Notion: <dán link task TF05A> · Nhánh: `dung/TF05A-gateway-rate-limit` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- `deploy/traefik/dynamic.yml`: hai middleware `rateLimit` của Traefik, đếm theo IP.
  - `rate-limit-auth`: `POST /api/auth/login`, `/register`, `/google`, `/password/forgot`, `/password/reset`, `/service-token`. Trung bình 30 request/phút, dồn tối đa 10. Router riêng `core-api-auth` (`priority: 100`).
  - `rate-limit-api`: mọi đường còn lại (`/api`, `/notifications`, `/ws`, `/ai`). Trung bình 50 request/giây, dồn tối đa 100; rộng tay vì nhiều máy dùng chung IP.
- `deploy/traefik/README.md`: đường đi, bảng giới hạn, cách cấu hình khi đặt sau load balancer (`ipStrategy.depth`, `forwardedHeaders.trustedIPs`), lý do gateway không kiểm JWT.
- README gốc: dòng gateway trỏ tới tài liệu trên.
- Không đổi code, không thêm thư viện.

## Khác docs/10 §3.9
- Chỉ rate limit **theo IP**. Theo user: Traefik nhóm theo header `Authorization` thì mọi request chưa đăng nhập dồn chung một bộ đếm, nên giới hạn theo tài khoản giữ trong module `access` (đăng nhập sai, quên mật khẩu, token service).
- Gateway **không kiểm JWT**: Traefik bản miễn phí cần plugin hoặc `forwardAuth`; `core-api`, `notification-service` đã tự kiểm bằng `@tripflix/auth`.

## Kết quả kiểm tra
Chạy ngày 2026-11-05, Traefik `v3.7` (cùng image với `deploy/compose.yaml`), core-api chạy trên máy với Postgres, Redis local. Bản sao `dynamic.yml` chỉ đổi địa chỉ service sang `host.docker.internal`, middleware và router giữ nguyên.

```
docker compose -f deploy/compose.yaml config -q → hợp lệ
Traefik khởi động: không có log lỗi cấu hình; GET /api/auth/me qua gateway → 401 từ core-api
```

**7/7 PASS**:

```
(1) POST /api/auth/register 15 lần liền: 10 lần đầu tới core-api (400×10), sau đó 429×5
(2) 429 do gateway trả: "Too Many Requests", Retry-After=2
(3) POST /api/auth/refresh 15 lần (không thuộc nhóm chặt): 401×15, không có 429
(4) sau 2,5 giây: lại gửi được 1 request đăng ký
(5) ngay sau đó lại bị chặn
(6) 300 request cùng lúc tới /api/auth/me: 401×114 tới core-api, 429×186
(7) 1,5 giây sau: dùng lại bình thường
```

Kiểm bằng `register` với body rỗng nên core-api trả `400` ngay, không ghi Redis hay database.

## Cách kiểm lại
1. `pnpm stack:be` (BE + gateway).
2. Gửi nhanh hơn 10 lần `POST http://localhost:8080/api/auth/register` với body `{}`: từ lần thứ 11 nhận `429`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không đụng code của người khác (`deploy/` thuộc Dũng).
- App, web: gặp `429` từ gateway thì chờ theo `Retry-After` rồi thử lại.
