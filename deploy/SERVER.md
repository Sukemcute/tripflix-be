# Chạy Tripflix trên một máy server

`compose.server.yaml` chạy image production trên một máy. Postgres và Redis không mở cổng, API chỉ nghe trên `127.0.0.1`. `compose.yaml` vẫn chỉ dùng cho máy dev.

Đã làm: giai đoạn 1 đến 5, deploy web và backend từ CI (backup database trước mỗi lần deploy backend). Chưa làm: `video-worker`, backup định kỳ.

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

## Giai đoạn 5: AI (TF14 tóm tắt, TF32 kiểm duyệt)

Hai service cùng image `ghcr.io/sukemcute/tripflix-ai/ai-service` (public) và cùng `AI_TAG`, đều trong profile `ai`: `ai-summary-worker` tóm tắt bình luận, `ai-service` nhận `POST /moderate` từ core-api.

### Tóm tắt bình luận

Worker nghe bình luận, gọi DeepSeek, ghi tóm tắt về core-api. core-api cần từ `sha-307edcd` trở lên để ẩn `safety.pendingWarnings` với người không phải staff.

1. Tạo service client, ghi secret thẳng vào `.env.server`, không in ra màn hình. Secret chỉ tạo được một lần; client `ai-service` đã có thì lệnh báo lỗi, khi đó hỏi người đang giữ secret.

```bash
cd ~/tripflix-be
dc --profile api run --rm --no-deps -T core-api node dist/cli/service-client.js create ai-service core-api \
  | sed -n 's/^SERVICE_CLIENT_SECRET=/AI_SERVICE_CLIENT_SECRET=/p' >> deploy/.env.server
grep -c '^AI_SERVICE_CLIENT_SECRET=.' deploy/.env.server   # 1 là đạt
```

2. Trong `.env.server` cần `DEEPSEEK_API_KEY` (không gửi qua chat) và `AI_TAG=sha-<7 ký tự>`. Ghim `AI_TAG` thì thêm tag đó vào `GHCR_KEEP_TAGS` của repo `tripflix-ai`.
3. Chạy và xem log:

```bash
dc --profile ai up -d ai-summary-worker
dc --profile ai logs -f ai-summary-worker
```

Mặc định worker được 1 nhân và 1 luồng phân loại (`AI_WORKER_CPUS`, tối đa 1,5 GB RAM), để không giành CPU của core-api trên máy 2 vCPU. Đo bằng `docker stats` khi có nhiều bình luận trước khi tăng. Tắt gọi DeepSeek khẩn cấp: đặt `SUMMARY_LLM_KILL=true` rồi chạy lại lệnh `up`. Lần chạy đầu worker đọc lại cả sự kiện bình luận cũ, mỗi bài có bình luận tốn khoảng một lần gọi DeepSeek.

### Kiểm duyệt (`ai-service`)

core-api gọi `POST http://ai-service:8000/moderate` với chữ và URL ảnh của bài, bình luận; ai-service hỏi OpenAI moderation (miễn phí) rồi trả cờ vi phạm. Gateway không có đường tới ai-service, nên chỉ gọi được trong mạng nội bộ. ai-service chỉ nhận service token của core-api, kiểm bằng `http://core-api:3000/.well-known/jwks.json`, issuer `tripflix-core` như core-api. Không dùng bộ phân loại, không cần `LLM_PROVIDER`; giới hạn nửa nhân, 384 MB RAM. Cần `AI_TAG` từ `sha-7a1ab56` trở lên.

1. Nhập key OpenAI thẳng vào `.env.server`, không gửi qua chat, không in ra màn hình:

```bash
cd ~/tripflix-be
read -rs k && printf 'OPENAI_API_KEY=%s\n' "$k" >> deploy/.env.server && unset k
grep -c '^OPENAI_API_KEY=.' deploy/.env.server   # 1 là đạt
```

2. Chạy, rồi gọi thử từ core-api không kèm token: `401` là ai-service chạy, core-api tới được và đã chặn người gọi lạ.

```bash
dc --profile ai up -d --wait ai-service
dc --profile api exec -T core-api node -e "fetch('http://ai-service:8000/moderate',{method:'POST'}).then(r=>console.log(r.status))"
```

Thiếu key thì `/moderate` trả `503` và core giữ bước lọc regex. Thu hồi key: xoá dòng `OPENAI_API_KEY` rồi chạy lại lệnh `up`.

## Đăng nhập Google

Backend kiểm ID token của Google theo `GOOGLE_CLIENT_IDS`. Web gắn `NEXT_PUBLIC_GOOGLE_CLIENT_ID` vào bundle lúc build. Thiếu một trong hai thì không đăng nhập bằng Google được: backend trả `503`, web không hiện nút.

1. **Google Cloud Console → APIs & Services → Credentials**, mở OAuth client loại *Web application* mà dev đang dùng (hoặc tạo client mới). Trong *Authorized JavaScript origins*, thêm `https://<WEB_HOST>` và `https://www.<WEB_HOST>`. Web dùng popup lấy ID token nên không cần redirect URI.
2. **OAuth consent screen:** chuyển *Publishing status* sang *In production*. Nếu vẫn để *Testing*, chỉ các email nằm trong *Test users* mới đăng nhập được.
3. Thêm Client ID vào `.env.server`. Client ID là giá trị công khai, không phải secret:

   ```bash
   GOOGLE_CLIENT_IDS=<client id>.apps.googleusercontent.com
   ```

   App mobile có client Android hoặc iOS riêng thì thêm vào cùng dòng, cách nhau bằng dấu phẩy.
4. Khởi động lại API: `dc --profile api --profile gateway --profile mail up -d --wait`.
5. Trên GitHub repo `tripflix-fe`, vào Settings → Secrets and variables → Actions → *Variables*, tạo biến `GOOGLE_CLIENT_ID` có cùng Client ID. Workflow `publish` truyền biến này vào lúc build web. Merge một commit bất kỳ vào `develop` để build lại web.

Kiểm tra: `curl -s -X POST https://<API_HOST>/api/auth/google -H 'content-type: application/json' -d '{"idToken":"x"}'` phải trả `401` (token sai), không phải `503`. Trang `/login` phải hiện nút Google, và đăng nhập thử bằng tài khoản Google phải vào được trang tài khoản.

## VNPay sandbox

Thêm `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` vào `.env.server`, không commit và không gửi qua chat. Thiếu một trong hai thì các API VNPay trả 404. `VNPAY_RETURN_URL` mặc định là trang kết quả trên web, đặt IPN của merchant về `https://<API_HOST>/api/payments/vnpay/ipn`.

## Vận hành

```bash
dc --profile api logs -f core-api
dc --profile api --profile gateway --profile mail pull && dc --profile api --profile gateway --profile mail up -d --wait   # cập nhật bản mới, migrate chạy lại trước API
```

`CORE_API_TAG` (core-api và migrate) và `NOTIFICATION_TAG` (notification-service) trong `.env.server` chọn bản chạy. Mỗi app một biến vì CI chỉ build image của app có thay đổi, nên sha mới nhất của app này có thể không có ở app kia. Nên dùng `sha-<7 ký tự>` để biết chính xác bản đang chạy. Biến nào chưa đặt thì dùng `IMAGE_TAG` cũ, không có cả hai thì dùng `develop`.

Khi bật deploy backend tự động, mỗi lần merge vào `develop` có image mới thì CI ghi đè `CORE_API_TAG`, `NOTIFICATION_TAG`. Muốn giữ một bản cũ thì tắt `API_AUTO_DEPLOY` trước (mục Deploy backend tự động).

Đổi bản ghim thì cập nhật luôn biến repo `GHCR_KEEP_TAGS` (Settings → Secrets and variables → Actions → Variables), để workflow dọn GHCR hằng tuần không xoá bản đang chạy. Nhiều tag cách nhau bằng dấu cách.

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
- Phần này chỉ áp dụng cho web. Backend xem mục dưới.

## Deploy backend tự động

Merge vào `develop` của `tripflix-be`: CI đạt, GitHub build image của app có thay đổi. Sau đó, với từng app trong `core-api` rồi `notification-service`, workflow SSH vào server chạy `deploy-api.sh <app> sha-xxxxxxx`. Script:

1. Ghi tag mới vào `CORE_API_TAG` hoặc `NOTIFICATION_TAG` trong `.env.server`, rồi pull image. Pull lỗi thì trả lại file, app không bị đụng tới.
2. Backup database của app (`core` hoặc `notification`) vào `~/backups/auto-<db>-<giờ>-before-<tag>.dump`, giữ 20 bản mới nhất mỗi database. Backup lỗi thì không deploy.
3. Chạy app. core-api chạy `migrate` trước; migrate lỗi thì core-api cũ vẫn chạy.
4. Kiểm tra healthcheck của container. Với core-api, kiểm thêm `https://<API_HOST>/api/v1/feed` phải trả 200.
5. Không đạt thì trả lại `.env.server` và chạy lại image cũ, không chạy lại migrate. Workflow báo lỗi kèm log của app.

Chỉ chạy khi biến repo `API_AUTO_DEPLOY=true` (Settings → Secrets and variables → Actions → Variables). Đặt `false` để tắt ngay, ví dụ trong lúc demo; image vẫn được build. App chưa chạy trên server thì script chỉ ghi tag, không tự bật.

Log từng lần deploy nằm trong `~/deploy-logs/`. Script chạy tiếp đến cuối kể cả khi GitHub huỷ lần chạy (có merge mới) hay SSH bị đứt. Lần deploy sau đợi lần trước xong rồi mới chạy.

### Cài một lần

Trên máy của bạn, tạo key riêng cho repo này (không dùng lại key của `tripflix-fe`, để thu hồi riêng được), đưa private key vào secret rồi xoá file:

```bash
ssh-keygen -t ed25519 -N '' -C ci-tripflix-be -f ./tripflix-be-deploy
gh secret set DEPLOY_SSH_KEY --repo Sukemcute/tripflix-be < ./tripflix-be-deploy
rm ./tripflix-be-deploy
cat ./tripflix-be-deploy.pub   # dòng này dán vào server ở bước dưới
```

Trên server, sau khi chép `deploy/` mới lên máy (`<user>` là user đang chạy compose):

```bash
sudo install -m 755 -o root -g root ~/tripflix-be/deploy/deploy-api.sh /opt/tripflix/deploy-api.sh
printf '%s\n' 'deploy ALL=(<user>) NOPASSWD: /opt/tripflix/deploy.sh, /opt/tripflix/deploy-api.sh' | sudo tee /etc/sudoers.d/tripflix-deploy >/dev/null
sudo chmod 440 /etc/sudoers.d/tripflix-deploy
sudo visudo -cf /etc/sudoers.d/tripflix-deploy
# Key chỉ chạy được script này: không shell, không chuyển cổng.
echo 'restrict,command="/opt/tripflix/deploy-api.sh" <dòng trong tripflix-be-deploy.pub>' | sudo tee -a /home/deploy/.ssh/authorized_keys >/dev/null
# Phải in "forcecommand none". Nếu in tên script của web thì sshd đang ép mọi key của deploy chạy script web: báo người cài.
sudo sshd -T -C user=deploy,host=x,addr=127.0.0.1 | grep -i forcecommand
```

Thử trên server với bản đang chạy (deploy lại đúng bản cũ, có backup): `/opt/tripflix/deploy-api.sh core-api sha-<bản đang chạy>`. Sau đó chạy workflow `deploy-api` trên GitHub với cùng commit. Cả hai đạt thì mới đặt `API_AUTO_DEPLOY=true`.

Quay về bản cũ: chạy workflow `deploy-api` trên GitHub, chọn app và commit muốn dùng, hoặc trên server chạy `/opt/tripflix/deploy-api.sh core-api sha-xxxxxxx`. Bản cũ không hiểu database sau migration mới thì phải khôi phục database (mục dưới).

- Kiểm tra tự động chỉ phát hiện app không trả lời, không phát hiện lỗi nghiệp vụ.
- Deploy chỉ kéo image mới. Sửa `compose.server.yaml` hay file khác trong `deploy/` vẫn phải chép lên server bằng tay.
- Bản server đang chạy thường là bản build mới nhất của app, nằm trong 5 bản workflow dọn GHCR giữ lại. Deploy lỗi rồi quay về, hay ghim tay một bản cũ, thì thêm tag đó vào `GHCR_KEEP_TAGS`.

### Khôi phục database

Thử khôi phục vào một database tạm, không đụng dữ liệu thật. Nên làm sau khi cài, và thỉnh thoảng làm lại:

```bash
f=$(ls -1t ~/backups/auto-core-*.dump | head -n 1)
dc exec -T postgres createdb -U postgres restore_test
dc exec -T postgres pg_restore -U postgres -d restore_test < "$f"
dc exec -T postgres psql -U postgres -d restore_test -tAc "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')"   # số bảng, phải lớn hơn 0
dc exec -T postgres dropdb -U postgres restore_test
```

Khôi phục thật ghi đè database `core`: mọi dữ liệu ghi sau lúc backup bị mất. Chỉ làm khi bản cũ không chạy được với database đã migrate, và báo team trước:

```bash
dc --profile api --profile ai stop core-api ai-summary-worker
dc exec -T postgres pg_restore -U postgres -d core --clean --if-exists --single-transaction < ~/backups/auto-core-<giờ>-before-<tag mới>.dump
/opt/tripflix/deploy-api.sh core-api sha-<bản cũ>   # core-api đang dừng nên chỉ ghi tag
dc --profile api --profile ai up -d --wait core-api ai-summary-worker
```
