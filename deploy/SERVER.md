# Chạy Tripflix trên một máy server

`compose.server.yaml` chạy image production trên một máy. Postgres và Redis không mở cổng, API chỉ nghe trên `127.0.0.1`. `compose.yaml` vẫn chỉ dùng cho máy dev.

Đã làm: giai đoạn 1, 2 và 3. Chưa làm: `video-worker`, `notification-service`, backup, deploy từ CI.

## Chuẩn bị máy

Máy phải là x86, vì CI chỉ build image x86.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # đăng xuất rồi vào lại SSH
```

Chép code từ laptop lên máy. Cách này không để credential GitHub trên server, và `git archive` chỉ lấy file đã commit nên không chép `.env`:

```bash
git archive <nhánh> | gcloud compute ssh tripflix-staging --zone=asia-southeast1-b -- 'mkdir -p ~/tripflix-be && tar -x -C ~/tripflix-be'
```

`gcloud compute ssh` đăng nhập bằng tên người dùng trên laptop, còn nút SSH trên web dùng tên tài khoản Google. Đó là hai tài khoản khác nhau trên máy, nên chỉ thao tác bằng một tài khoản.

Tải image cần `docker login ghcr.io`, mật khẩu là classic token chỉ có quyền `read:packages`. Dán token trực tiếp vào terminal.

## Giai đoạn 1: Postgres và Redis

```bash
cd ~/tripflix-be
sh deploy/init-server-env.sh
echo "alias dc='docker compose -f ~/tripflix-be/deploy/compose.server.yaml --env-file ~/tripflix-be/deploy/.env.server'" >> ~/.bashrc
source ~/.bashrc
dc up -d --wait
dc ps
```

`init-server-env.sh` sinh `deploy/.env.server`, gồm mật khẩu và khoá ký token. Không commit và không gửi file này qua chat. Mật khẩu chỉ áp dụng khi volume Postgres còn trống, nên về sau đổi trong file sẽ không đổi trong database.

Xong khi `postgres` và `redis` đều `healthy`, và cột cổng không có `0.0.0.0`.

## Giai đoạn 2: core-api và dữ liệu mẫu

```bash
dc --profile api up -d --wait
dc --profile seed run --rm --build seed
curl -s localhost:3000/health
curl -s 'localhost:3000/api/v1/feed?limit=3'
```

- Giai đoạn này chưa cần AWS key: link video trong seed là link CloudFront đã có sẵn.
- Seed build từ mã nguồn vì image production không có file seed, trên máy 2 vCPU mất vài phút. Chạy lại không tạo trùng.
- Tài khoản mẫu, gồm cả superadmin, dùng `SEED_PASSWORD` trong `.env.server`.

Xong khi `/health` trả 200 và đi hết các trang feed được 10 bài.

Xem từ laptop qua SSH, không cần mở cổng:

```bash
gcloud compute ssh tripflix-staging --zone=asia-southeast1-b -- -L 3000:127.0.0.1:3000
```

## Giai đoạn 3: HTTPS

Traefik nhận cổng 80 và 443, lấy chứng chỉ Let's Encrypt và chuyển `/api` tới `core-api`. Chưa có tên miền thì dùng `<IP nối bằng dấu ->.sslip.io`.

Trên laptop, giữ IP hiện tại làm IP tĩnh và mở cổng web:

```bash
gcloud compute addresses create tripflix-staging-ip --region=asia-southeast1 --addresses=<IP>
gcloud compute firewall-rules create tripflix-allow-web --allow=tcp:80,tcp:443 --target-tags=tripflix-web --source-ranges=0.0.0.0/0
gcloud compute instances add-tags tripflix-staging --zone=asia-southeast1-b --tags=tripflix-web
```

Trên server, đặt `API_HOST` trong `.env.server` rồi chạy:

```bash
dc --profile api --profile gateway up -d --wait
dc --profile gateway logs traefik | tail
```

Xong khi `https://<API_HOST>/api/v1/feed?limit=1` trả 200 với chứng chỉ hợp lệ, và app trên điện thoại dùng mạng di động xem được feed khi API trên laptop đã tắt.

Tường lửa cần một lúc mới có hiệu lực. Nếu log Traefik báo `Timeout during connect`, chờ một phút rồi chạy `docker restart tripflix-server-traefik-1` để xin lại chứng chỉ. Traefik tự gia hạn chứng chỉ, nên không xoá volume `letsencrypt`.

Gateway chỉ mở `/api`; `/health` và `/.well-known/jwks.json` chỉ dùng trong mạng nội bộ. Muốn app dùng địa chỉ này thì đặt `EXPO_PUBLIC_API_URL=https://<API_HOST>` rồi khởi động lại Expo.

## Vận hành

```bash
dc --profile api logs -f core-api
dc --profile api --profile gateway pull && dc --profile api --profile gateway up -d --wait   # cập nhật bản mới, migrate chạy lại trước API
```

`IMAGE_TAG` trong `.env.server` chọn bản chạy. Nên dùng `sha-<7 ký tự>` để biết chính xác bản đang chạy.

`docker compose down -v` xoá luôn database. Chưa có backup thì không chạy lệnh này trên server.
