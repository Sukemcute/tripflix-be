# Test tải tripflix.io.vn

Kết quả lần đầu: `docs/evidence/TF07-load-test-dang-nhap.md`.

| File | Chạy ở đâu | Làm gì |
|---|---|---|
| `gen-users-sql.mjs` | Laptop, trong repo | Sinh `users.sql` tạo N tài khoản `loadtestNNNN@tripflix.local` (đuôi `.local`: không gửi email) |
| `login.js` | Máy bắn (k6) | N người bấm đăng nhập cùng lúc |
| `browse.js` | Máy bắn (k6) | N người dùng app: feed 60%, xem bài 20%, thả cảm xúc 10%, thông báo 10% |
| `ws.mjs` | Máy bắn (Node) | N kết nối WebSocket giữ mở |
| `record-server.sh` | Server | Ghi CPU, RAM, kết nối DB, tồn đọng notification mỗi 5 giây |
| `lock-users.sql` | Server | Khoá tài khoản test sau buổi test (không xoá, RULES §8) |

## Trước buổi test
1. Hẹn giờ với chủ server, báo team không deploy trong giờ test.
2. Laptop: `LOADTEST_PASSWORD=<mật khẩu test> node tools/loadtest/gen-users-sql.mjs 500 > tools/loadtest/users.sql`
   (PowerShell: `| Set-Content -Encoding ascii ...` để file không có BOM). Chạy lại không tạo trùng.
3. Chép lên server, chạy: `dc exec -T postgres psql -U postgres -d core < users.sql`.
4. Quá 10 người phải cho IP máy bắn đi qua rate limit (auth chỉ cho dồn 10 request mỗi IP):
   thêm tạm router `loadtest-bypass` vào `deploy/traefik/server.yml` trên server, sau khi backup file:
   ```yaml
   loadtest-bypass:
     rule: Host(`{{ env "API_HOST" }}`) && PathPrefix(`/api`) && ClientIP(`<IPv4 máy bắn>`)
     priority: 1000
     service: core-api
     entryPoints: [websecure]
     tls:
       certResolver: letsencrypt
   ```
   - API chỉ có IPv4: lấy IP bằng `curl -4 https://ifconfig.me`, không dùng IPv6.
   - Ghi bằng `cat file.moi > server.yml` (giữ inode) để Traefik tự nạp lại, không cần restart.

## Mỗi lần chạy (USERS = 10, 20, 50, 100, 200, 500)
- Trong `tools/loadtest`: `k6 run -e BASE=https://api.tripflix.io.vn -e PASSWORD=... -e USERS=100 login.js`
- Server (tuỳ chọn): `sh record-server.sh login-100`, Ctrl+C khi xong.
- k6 chỉ báo số lỗi; lỗi gì thì xem log core-api: `docker logs --since 3m <core-api> | grep auth/login`.
- Nghỉ vài phút giữa hai lần. Dừng khi lỗi trên 5%, CPU kịch quá 1 phút, hoặc web thật không vào được.

Không bắn qua `ssh -L 3000:localhost:3000`: đường ống ssh trên laptop từ chối kết nối từ khoảng 140 kết nối cùng lúc.

## Sau buổi test
Trả `server.yml` từ bản backup (ghi rõ tên file, không dùng biến qua `sudo -iu`), kiểm `grep -c loadtest-bypass` = 0.
Không test lại nữa thì chạy `lock-users.sql`.

Ghi chú: `browse.js` chỉ thả cảm xúc lên 10 bài seed (tác giả là tài khoản mẫu) và bỏ ngay sau đó, nên không gửi thông báo cho người dùng thật.
