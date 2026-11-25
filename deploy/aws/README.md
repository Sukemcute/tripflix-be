# Media dev trên AWS

Dev dùng bucket S3 thật, không dùng MinIO (docs/architecture/11 Q9). Phụ trách: Phong.

- Bucket: `tripflix-media-dev`, vùng `ap-southeast-2`. Chính sách SCP của tổ chức AWS chặn tạo bucket ở `ap-southeast-1`.
- CloudFront: `E82GXSZ0QET03`, domain `d399hxccn6y84z.cloudfront.net`, tên miền riêng `media.tripflix.io.vn` (TF82).

## Thiết lập

Cần quyền quản trị, nên chạy trong AWS CloudShell, không tạo key quản trị trên máy. CloudShell tự đặt `AWS_REGION` theo vùng đang chọn trên Console, nên phải chọn `ap-southeast-2` hoặc đặt biến này khi chạy script.

```bash
./setup-dev-media.sh
./create-dev-member.sh phong
```

Chạy lại an toàn. Sau đó tạo access key cho `tripflix-dev-<tên>` trong Console, rồi ghi key và các giá trị `setup-dev-media.sh` in ra vào `deploy/.env`.

## Cấu hình

| File | Việc | Vì sao |
|---|---|---|
| `cors.json` | Cho `PUT`, `GET`, `HEAD`, trả header `ETag` | Web phải đọc được `ETag` của từng phần để hoàn tất upload |
| `lifecycle.json` | Xoá upload dở sau 1 ngày, file gốc trong `dev/<tên>/uploads/` sau 7 ngày, `staging/uploads/` sau 30 ngày | Theo docs Feed. Có thành viên mới thì thêm một luật. Staging giữ lâu hơn vì kiểm duyệt lại bài (trích khung hình) đọc file gốc |
| `bucket-policy.template.json` | CloudFront chỉ đọc `dev/*/videos/*` và `dev/*/images/*` | File gốc không phát công khai. `images/` chứa ảnh công khai như ảnh khách sạn, không để giấy tờ hay chứng từ ở đây |
| `cloudfront-distribution.template.json` | Chỉ HTTPS, cache theo `Cache-Control` của file, CORS cho web | `master.m3u8` cache 60 giây, còn đoạn video cache 1 năm |
| `media-domain.jq` | Gắn `media.tripflix.io.vn`, tách behavior `*.m3u8` và `*.ts` từ behavior mặc định | Trình duyệt chỉ gửi cookie ký cho tên miền con của `tripflix.io.vn`, không gửi cho `*.cloudfront.net` |
| `video-cors.jq` | Gắn policy CORS có credentials `tripflix-video-cors` cho hai behavior video | hls.js gửi cookie bằng XHR, cần origin cụ thể thay vì `*` |
| `video-lock.jq` | Bật hoặc tắt key group trên hai behavior video | Chỉ video cần cookie ký; ảnh vẫn công khai để không phải sửa màn nào |
| `iam-dev-member-policy.template.json` | Ghi và đọc `dev/<tên>/*`, liệt kê bucket | Có `s3:ListBucket` thì file thiếu trả 404 như production, nên `libs/storage` báo đúng lỗi |

## Tên miền và khoá video (TF82)

Video HLS (`*.m3u8`, `*.ts`) chỉ tải được khi request có cookie CloudFront do core-api ký (`POST /api/media/playback-session`). Ảnh vẫn công khai. `cloudfront-distribution.template.json` vẫn là cấu hình gốc lúc tạo mới; ba script dưới đây chồng thêm lên distribution đang chạy, chạy lại an toàn. Chạy trong CloudShell như phần trên.

DNS của `tripflix.io.vn` quản lý ở tenten.vn. Ô Tên chỉ nhập phần trước `.tripflix.io.vn`, và kiểm dòng gợi ý trong hộp thoại là đúng tên miền trước khi lưu.

1. Chứng chỉ ở **us-east-1** (CloudFront chỉ nhận vùng này):
   ```bash
   CERT_ARN=$(aws acm request-certificate --region us-east-1 --domain-name media.tripflix.io.vn \
     --validation-method DNS --query CertificateArn --output text)
   aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
     --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
   ```
   Thêm bản ghi CNAME in ra vào tenten, rồi `aws acm wait certificate-validated --region us-east-1 --certificate-arn "$CERT_ARN"`. Giữ bản ghi này: ACM dùng nó để tự gia hạn.
2. `./setup-media-domain.sh`, chờ `aws cloudfront wait distribution-deployed --id E82GXSZ0QET03`, rồi thêm CNAME `media` → `d399hxccn6y84z.cloudfront.net` ở tenten. Video lúc này chưa khoá.
3. Tạo cặp khoá **trên server**, để khoá riêng không rời máy:
   ```bash
   mkdir -p ~/.tripflix-keys && chmod 700 ~/.tripflix-keys && cd ~/.tripflix-keys && umask 077
   openssl genrsa -out cloudfront-playback.pem 2048
   openssl rsa -in cloudfront-playback.pem -pubout -out cloudfront-playback.pub.pem
   ```
   Chép nội dung `cloudfront-playback.pub.pem` sang CloudShell rồi chạy `./add-playback-key.sh cloudfront-playback.pub.pem`. Script in ra `CLOUDFRONT_KEY_PAIR_ID`.
4. Trên server, thêm vào `deploy/.env.server` (lệnh không in khoá ra màn hình), đổi `MEDIA_CDN_URL`, rồi tạo lại core-api (`deploy/SERVER.md`):
   ```bash
   { echo "CLOUDFRONT_KEY_PAIR_ID=<ID ở bước 3>"
     echo "CLOUDFRONT_PRIVATE_KEY=$(base64 -w0 < ~/.tripflix-keys/cloudfront-playback.pem)"
     echo "MEDIA_COOKIE_DOMAIN=.tripflix.io.vn"; } >> ~/tripflix-be/deploy/.env.server
   sed -i 's#^MEDIA_CDN_URL=.*#MEDIA_CDN_URL=https://media.tripflix.io.vn#' ~/tripflix-be/deploy/.env.server
   ```
   Kiểm: `curl -s -X POST https://api.tripflix.io.vn/api/media/playback-session` trả `cookies` có 3 khoá.
5. Trước khi deploy bản web dùng hls.js (TF64): `./setup-video-cors.sh`. Chrome và Firefox máy tính phát qua hls.js với `withCredentials`, và trình duyệt không nhận `Access-Control-Allow-Origin: *` khi request có cookie. Policy `tripflix-video-cors` chỉ gắn cho `*.m3u8`, `*.ts`, trả đúng origin (mặc định `https://tripflix.io.vn` và `https://admin.tripflix.io.vn`, đổi bằng `WEB_ORIGINS`; chạy với danh sách khác thì origin thiếu trong đó mất CORS) kèm `Access-Control-Allow-Credentials: true`. Kiểm với từng origin: `curl -sI -H 'Origin: https://admin.tripflix.io.vn' <link .m3u8>` có `access-control-allow-origin: https://admin.tripflix.io.vn` và `access-control-allow-credentials: true`.
6. Khi app và web đã gửi cookie: `./set-video-lock.sh on`. Kiểm `curl` một file `.m3u8` không kèm cookie phải ra 403, app và web vẫn phát được. Video lỗi thì `./set-video-lock.sh off`, vài phút sau là như cũ.
7. Cho máy dev: `./set-dev-video.sh open`. core-api chạy local không có `CLOUDFRONT_*` nên `playback-session` trả cookie rỗng, và khoá ở bước 6 áp cho mọi `.m3u8`, `.ts`, kể cả `dev/<tên>/`. Script thêm lên đầu danh sách, vì CloudFront chọn behavior khớp đầu tiên: `dev/*.m3u8`, `dev/*.ts` chép từ behavior video nhưng bỏ khoá (giữ `tripflix-video-cors`, vì hls.js gửi cookie tới mọi video và trình duyệt không nhận `*`), và `dev/*` chép từ behavior mặc định cho ảnh. Video `staging/*` vẫn khoá. Kiểm: `curl -so /dev/null -w '%{http_code}\n'` một file `.m3u8` dưới `dev/` ra 200, dưới `staging/` ra 403. Khoá lại: `./set-dev-video.sh close`. Không cấp khoá CloudFront cho máy dev: key group tin mọi khoá như nhau, cầm khoá dev là ký được cookie xem cả video staging.

**Xoay khoá**: tạo cặp khoá mới trên server như bước 3, `./add-playback-key.sh` với public key mới (key group giữ cả hai khoá), đổi hai biến `CLOUDFRONT_*` trong `.env.server` và tạo lại core-api. Đợi hết hạn cookie cũ (`MEDIA_PLAYBACK_TTL_SEC`, mặc định 6 giờ) rồi gỡ khoá cũ khỏi key group trên Console. Lộ khoá riêng thì làm ngay, và gỡ khoá cũ không cần đợi.
