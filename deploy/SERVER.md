# Chạy Tripflix trên một máy server

`compose.server.yaml` chạy image production trên một máy. Postgres và Redis không mở cổng, API chỉ nghe trên `127.0.0.1`. `compose.yaml` vẫn chỉ dùng cho máy dev.

Đã làm: giai đoạn 1 và 2. Chưa làm: HTTPS, `video-worker`, `notification-service`, backup, deploy từ CI.

## Chuẩn bị máy

Máy phải là x86, vì CI chỉ build image x86.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # đăng xuất rồi vào lại SSH
```

Repo private nên máy cần hai quyền đọc:

- Clone repo: deploy key chỉ đọc của `tripflix-be`.
- Tải image: `docker login ghcr.io`, mật khẩu là classic token chỉ có quyền `read:packages`.

## Giai đoạn 1: Postgres và Redis

```bash
git clone git@github.com:Sukemcute/tripflix-be.git && cd tripflix-be
sh deploy/init-server-env.sh
alias dc='docker compose -f deploy/compose.server.yaml --env-file deploy/.env.server'
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
- Seed build từ mã nguồn vì image production không có file seed. Chạy lại không tạo trùng.
- Tài khoản mẫu, gồm cả superadmin, dùng `SEED_PASSWORD` trong `.env.server`.

Xong khi `/health` trả 200 và đi hết các trang feed được 10 bài.

Xem từ laptop qua SSH, không cần mở cổng:

```bash
gcloud compute ssh tripflix-staging --zone=asia-southeast1-b -- -L 3000:127.0.0.1:3000
```

## Vận hành

```bash
dc --profile api logs -f core-api
dc --profile api pull && dc --profile api up -d --wait   # cập nhật bản mới, migrate chạy lại trước API
```

`IMAGE_TAG` trong `.env.server` chọn bản chạy. Nên dùng `sha-<7 ký tự>` để biết chính xác bản đang chạy.

`docker compose down -v` xoá luôn database. Chưa có backup thì không chạy lệnh này trên server.
