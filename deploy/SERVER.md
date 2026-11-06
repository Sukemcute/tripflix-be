# Chạy Tripflix trên một máy server

`compose.server.yaml` chạy image production trên một máy. Postgres và Redis không mở cổng, API chỉ nghe trên `127.0.0.1`. `compose.yaml` vẫn chỉ dùng cho máy dev.

Đã làm: giai đoạn 1, 2 và 3 (gồm website). Chưa làm: `video-worker`, `notification-service`, backup, deploy `core-api` từ CI.

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
echo "alias dc='docker compose -f ~/tripflix-be/deploy/compose.server.yaml --env-file ~/tripflix-be/deploy/.env.server --env-file ~/tripflix-be/deploy/.env.web'" >> ~/.bashrc
touch ~/tripflix-be/deploy/.env.web
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

## Giai đoạn 3: HTTPS và website

Traefik nhận cổng 80 và 443, lấy chứng chỉ Let's Encrypt, chuyển API tới `core-api` và website tới `web`. Tên miền hiện tại là `tripflix.io.vn`, DNS quản lý ở Tenten.

DNS: `tripflix.io.vn`, `www.tripflix.io.vn` và `api.tripflix.io.vn` phải có bản ghi `A` trỏ về IP của máy.

Trên laptop, giữ IP hiện tại làm IP tĩnh, mở cổng web và chép code web lên máy:

```bash
gcloud compute addresses create tripflix-staging-ip --region=asia-southeast1 --addresses=<IP>
gcloud compute firewall-rules create tripflix-allow-web --allow=tcp:80,tcp:443 --target-tags=tripflix-web --source-ranges=0.0.0.0/0
gcloud compute instances add-tags tripflix-staging --zone=asia-southeast1-b --tags=tripflix-web
git -C <tripflix-fe> archive <nhánh> | gcloud compute ssh tripflix-staging --zone=asia-southeast1-b -- 'mkdir -p ~/tripflix-fe && tar -x -C ~/tripflix-fe'
```

Trên server, điền `API_HOST`, `WEB_HOST`, `AUTH_WEB_ORIGINS`, `AUTH_PASSWORD_RESET_URL` trong `.env.server`, rồi chạy:

```bash
dc --profile api --profile gateway build web
dc --profile api --profile gateway up -d --wait
dc --profile gateway logs traefik | tail
```

- Web build trên máy vì Next gắn địa chỉ API vào bundle lúc build. Đổi `API_HOST` thì phải build lại web.
- `AUTH_WEB_ORIGINS` phải chứa địa chỉ web, nếu không trình duyệt không gọi được API.
- Chỉ mở `/api` của API; `/health` và `/.well-known/jwks.json` chỉ dùng trong mạng nội bộ.
- App điện thoại dùng `EXPO_PUBLIC_API_URL=https://<API_HOST>`.
- Tường lửa cần một lúc mới có hiệu lực. Nếu log Traefik báo `Timeout during connect`, chờ một phút rồi chạy `docker restart tripflix-server-traefik-1`. Traefik tự gia hạn chứng chỉ, nên không xoá volume `letsencrypt`.

Xong khi website mở được với chứng chỉ hợp lệ, đăng nhập được trên trình duyệt, và app điện thoại xem được feed khi API trên laptop đã tắt.

## Giai đoạn 4: gửi email qua Amazon SES (TF05D)

`notification-service` gửi email xác thực, đặt lại mật khẩu và chào mừng. Trên server, service chạy ở profile `mail` và gửi qua SMTP của Amazon SES, từ địa chỉ `no-reply@tripflix.io.vn`. Triển khai backend TF05D cùng bản web có trang `/xac-thuc-email` khi SMTP đã sẵn sàng. Backend yêu cầu xác thực email khi tạo bản nháp, đăng bài hoặc bình luận.

Làm trên AWS Console, chọn region `ap-southeast-1` (Singapore). Dưới đây ghi `<region>` là region đã chọn.

1. **Xác thực tên miền.** SES → Configuration → Identities → Create identity → Domain `tripflix.io.vn`, bật Easy DKIM (RSA 2048). Thêm ba bản ghi CNAME do SES cung cấp vào DNS của tên miền.

   | Loại  | Tên                                | Giá trị                     |
   | ----- | ---------------------------------- | --------------------------- |
   | CNAME | `<mã 1>._domainkey.tripflix.io.vn` | `<mã 1>.dkim.amazonses.com` |
   | CNAME | `<mã 2>._domainkey.tripflix.io.vn` | `<mã 2>.dkim.amazonses.com` |
   | CNAME | `<mã 3>._domainkey.tripflix.io.vn` | `<mã 3>.dkim.amazonses.com` |

2. **MAIL FROM riêng.** Trong identity vừa tạo, chọn Custom MAIL FROM domain và nhập `mail.tripflix.io.vn`. Thêm hai bản ghi sau vào DNS.

   | Loại | Tên                   | Giá trị                                   |
   | ---- | --------------------- | ----------------------------------------- |
   | MX   | `mail.tripflix.io.vn` | `10 feedback-smtp.<region>.amazonses.com` |
   | TXT  | `mail.tripflix.io.vn` | `v=spf1 include:amazonses.com ~all`       |

3. **DMARC.** Thêm bản ghi TXT `_dmarc.tripflix.io.vn` với giá trị `v=DMARC1; p=none; rua=mailto:<email nhận báo cáo>`.
4. Chờ identity chuyển sang `Verified` (thường vài phút tới vài giờ). Kiểm DNS: `nslookup -type=CNAME <mã 1>._domainkey.tripflix.io.vn`.
5. **Ra khỏi sandbox.** Mặc định SES chỉ gửi tới địa chỉ đã xác thực trong SES. Account dashboard → Request production access: Mail type `Transactional`, Website `https://tripflix.io.vn`, mô tả: email xác thực tài khoản, đặt lại mật khẩu, xác nhận đặt chỗ; người nhận là người tự đăng ký; email bị trả lại (bounce) và khiếu nại được theo dõi trên SES. AWS thường trả lời trong 24 giờ. Trong lúc chờ, thêm email của mình vào Identities (Email address) để thử.
6. **Tạo SMTP credentials.** SES → SMTP settings → Create SMTP credentials. AWS tạo một IAM user và cho tên đăng nhập, mật khẩu SMTP (chỉ hiện một lần). Không dùng access key S3 hiện có.
7. Trên server, thêm các biến sau vào `.env.server`. URL-encode thành phần tên đăng nhập và mật khẩu SMTP nếu có ký tự đặc biệt.

   ```bash
   SMTP_URL=smtps://<SMTP user>:<mật khẩu đã encode>@email-smtp.<region>.amazonaws.com:465
   MAIL_FROM=Tripflix <no-reply@tripflix.io.vn>
   WEB_APP_URL=https://tripflix.io.vn
   AUTH_EMAIL_VERIFY_URL=https://tripflix.io.vn/xac-thuc-email
   AUTH_PASSWORD_RESET_URL=https://tripflix.io.vn/dat-lai-mat-khau
   ```

8. Bật thêm profile `mail`:

   ```bash
   dc --profile api --profile gateway --profile mail up -d --wait
   dc --profile mail logs -f notification-service
   ```

- GCP chặn cổng 25 ra ngoài, nên dùng cổng 465 (TLS) như trên.
- Thiếu `SMTP_URL` mà vẫn bật profile `mail` thì `notification-service` dừng ngay lúc khởi động, log ghi `SMTP_URL: bắt buộc ở production`.
- `AUTH_REGISTER_MAX_PER_IP_HOUR` (mặc định 5) giới hạn số lần yêu cầu gửi mã đăng ký mỗi IP mỗi giờ.

Kiểm tra bằng cách yêu cầu mã đăng ký, nhập mã nhận qua email, xác nhận tài khoản được tạo, sau đó kiểm luồng quên mật khẩu.

## VNPay sandbox

Thêm `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` vào `.env.server`, không commit và không gửi qua chat. Thiếu một trong hai thì các API VNPay trả 404. `VNPAY_RETURN_URL` mặc định là trang kết quả trên web, đặt IPN của merchant về `https://<API_HOST>/api/payments/vnpay/ipn`.

## Vận hành

```bash
dc --profile api logs -f core-api
dc --profile api --profile gateway --profile mail pull && dc --profile api --profile gateway --profile mail up -d --wait   # cập nhật bản mới, migrate chạy lại trước API
```

`IMAGE_TAG` trong `.env.server` chọn bản chạy. Nên dùng `sha-<7 ký tự>` để biết chính xác bản đang chạy.

`docker compose down -v` xoá luôn database. Chưa có backup thì không chạy lệnh này trên server.

## Deploy web tự động

Merge vào `develop` của `tripflix-fe`: CI đạt, GitHub build image web, rồi SSH vào server chạy `deploy-web.sh` với tag `sha-xxxxxxx`. Script pull image, khởi động lại riêng `web`, kiểm tra website; không đạt thì quay về bản trước và báo workflow lỗi.

Key của CI chỉ chạy được script này. User `deploy` không có quyền Docker, sudo chỉ cho phép chạy đúng script này dưới user đang chạy compose. Tag đang chạy nằm trong `deploy/.env.web`, file này không commit.

Cài trên server, sau khi chép `deploy/` mới lên máy (`<user>` là user đang chạy compose):

```bash
sudo install -m 755 -o root -g root ~/tripflix-be/deploy/deploy-web.sh /opt/tripflix/deploy.sh
echo 'deploy ALL=(<user>) NOPASSWD: /opt/tripflix/deploy.sh' | sudo tee /etc/sudoers.d/tripflix-deploy >/dev/null
sudo chmod 440 /etc/sudoers.d/tripflix-deploy
sudo visudo -cf /etc/sudoers.d/tripflix-deploy
```

Image trên GHCR là private, nên `<user>` phải `docker login ghcr.io` bằng token chỉ có quyền `read:packages`.

Quay về bản cũ: chạy workflow `deploy-web` trên GitHub với commit muốn dùng, hoặc trên server chạy `/opt/tripflix/deploy.sh sha-xxxxxxx`.

- Kiểm tra tự động chỉ phát hiện web không trả 200, không phát hiện lỗi giao diện hay nghiệp vụ.
- Phần này chỉ áp dụng cho web. `core-api` có migration, quay về image cũ không hoàn tác được database, nên cần backup trước khi tự động hoá.
