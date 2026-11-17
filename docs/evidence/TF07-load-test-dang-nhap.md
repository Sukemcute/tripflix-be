# TF07 — Test tải đăng nhập trên tripflix.io.vn

- Notion: (chưa có link) · Nhánh: `dung/TF07-load-test-dang-nhap` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Bộ script test tải trong `tools/loadtest/`: seed tài khoản test, k6 đăng nhập (`login.js`), k6 lướt app (`browse.js`), WebSocket (`ws.mjs`), ghi số liệu server (`record-server.sh`), khoá tài khoản sau test.
- Chạy kịch bản **N người bấm đăng nhập cùng lúc** (`login.js`, mỗi người 1 lần) trên server dùng chung `tripflix-staging` (e2-standard-2: 2 vCPU, 8 GB RAM, không swap, chạy chung mọi service). core-api `sha-52d1757`, chưa có đăng nhập bằng mã (TF05G).
- Đã chạy `browse.js`, `ws.mjs`: chưa.

## Kết quả
| Số người | Đường bắn | Thành công | Lỗi 500 | Timeout (>60s) | Người thành công chờ |
|---|---|---|---|---|---|
| 1 | qua Traefik | 1 | 0 | 0 | 0.36s |
| 5 | qua Traefik | 5 | 0 | 0 | 1.3–1.6s |
| 10 | qua Traefik | 10 | 0 | 0 | 2.3–3.8s |
| 20 | qua Traefik (bypass rate limit theo IP) | 16 | 4 | 0 | khoảng 4s |
| 50 | thẳng core-api qua ssh -L | 38 | 12 | 0 | khoảng 15s |
| 100 | thẳng core-api qua ssh -L | 96 | 4 | 0 | khoảng 27s |
| 200 | qua Traefik (bypass) | 155 | 16 | 29 | khoảng 57s |
| 500 | qua Traefik (bypass) | 20 | 4 | 476 | — (sụp) |

Số đo server lúc 100 người: CPU core-api đỉnh 192% (kịch 2 vCPU), RAM core-api 555 MiB, CPU Postgres 14%, RAM trống của máy thấp nhất 5.1 GB. Ở 500 người: load average 13.5, core-api còn 190% CPU hơn 2 phút sau khi k6 dừng; không khởi động lại, không OOM.

## Phát hiện
1. **Trần khoảng 3–3.5 lượt đăng nhập mỗi giây**, do argon2id (64 MiB, 3 vòng) chiếm CPU trên 2 vCPU.
2. **Lỗi 500 từ 20 người cùng lúc**: `timeout exceeded when trying to connect` khi `findByEmail`. Bắt tay SCRAM của `pg` (WebCrypto PBKDF2) dùng chung 4 luồng libuv với argon2; pool `access` tối đa 5, kết nối rảnh đóng sau 30s, `connectionTimeoutMillis` 3s. Khi đông người, mở kết nối mới phải xếp sau hàng argon2 nên quá 3s.
3. **Request bị bỏ vẫn chạy tiếp**: 500 người làm core-api bận thêm vài phút sau khi client đã timeout, tốc độ rơi còn khoảng 0.4 lượt mỗi giây.
4. Rate limit auth theo IP (dồn 10) chặn đúng: 1000 người chung một mạng (NAT) ngoài đời cũng sẽ bị chặn.

Hướng sửa (task riêng, chưa làm): giới hạn số argon2 chạy cùng lúc, bỏ request đã bị huỷ, giữ sẵn kết nối DB hoặc tăng `UV_THREADPOOL_SIZE`. Sau khi sửa chạy lại 50/100/200 để so.

## Kết quả kiểm tra
- `node --check` cho 4 script JS: OK; `sh -n record-server.sh`: OK; `gen-users-sql.mjs` sinh đúng SQL.
- Không chạy `pnpm turbo run lint typecheck test --affected`: `tools/loadtest` nằm ngoài workspace pnpm, không đổi code app.

## Cách kiểm lại
Xem `tools/loadtest/README.md`: seed tài khoản, mở bypass theo IPv4, `k6 run ... login.js`, đọc log core-api.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Test chạy trên server của Phong (`deploy/`): Phong cấp quyền và cho mở bypass rate limit theo IP. Router bypass đã gỡ, server về bình thường.
- Dữ liệu còn lại trên server: 500 tài khoản `loadtestNNNN@tripflix.local` (chưa khoá, giữ để test lại sau khi sửa) và phiên đăng nhập của chúng.
- `tools/loadtest/package.json` dùng `socket.io-client` (đã có trong repo) cho `ws.mjs`, cài riêng trên máy bắn, không vào workspace.
