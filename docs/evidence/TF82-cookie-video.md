# TF82 — Cookie ký cho video trên CloudFront (phần BE và AWS)

- Jira: SCRUM-103 (TF82) · Nhánh: `phong/TF82-signed-cookie` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-17

## Bối cảnh
Mentor góp ý "data/content chưa được proxy". Ngày 2026-11-17 kiểm trên staging:

| Kiểm | Kết quả trước khi sửa |
|---|---|
| `curl` `master.m3u8`, playlist 360p, `seg_000.ts` trên CloudFront, không kèm cookie | 200, tải được cả đoạn video |
| Gọi thẳng S3 (`tripflix-media-dev.s3.amazonaws.com`) | 403 |
| `staging/uploads/` (file gốc) qua CloudFront | 403 |
| CORS của API với Origin lạ | Không trả `access-control-allow-origin` |

Ai có link video cũng xem và tải được, nhúng sang trang khác được, và link không bao giờ hết hạn. TF63 ghi Done trên Jira nhưng chưa có code ký cookie.

## Đã làm
- `POST /api/media/playback-session` (`content/media`):
  - Ký cookie CloudFront bằng custom policy cho `<MEDIA_CDN_URL>/*`, hạn 6 giờ (`MEDIA_PLAYBACK_TTL_SEC`). Một cookie dùng cho mọi video, app không phải xin lại khi lướt.
  - Khách chưa đăng nhập cũng gọi được, vì khách cũng xem Reels.
  - Trình duyệt (có header `Origin`) nhận `Set-Cookie` cho `MEDIA_COOKIE_DOMAIN`: `HttpOnly; Secure; SameSite=Lax`, hết hạn đúng lúc chữ ký hết hạn.
  - App nhận cookie trong body và tự gắn header `Cookie` cho player. App không nhận `Set-Cookie`, vì kho cookie của máy sẽ giữ bản cũ và player gửi lẫn hai bản.
  - Chưa có khoá thì trả `{ cookies: {}, expiresAt: null }`, video phát như cũ. Deploy trước khi điền khoá là an toàn.
- Thư viện mới `@aws-sdk/cloudfront-signer`: thư viện chính thức của AWS để ký cookie CloudFront, Phong chọn thay vì tự viết bằng `node:crypto`. Bản đang cài là 3.1166.0, vì catalog ghi `^3.1161.0` như các gói `@aws-sdk` khác.
- Biến môi trường `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY` (PEM mã hoá base64), `MEDIA_COOKIE_DOMAIN`, `MEDIA_PLAYBACK_TTL_SEC`. Đặt thiếu một trong hai biến khoá, hoặc có khoá mà thiếu `MEDIA_CDN_URL`, thì core-api không khởi động.
- AWS (`deploy/aws/`):
  - Tên miền `media.tripflix.io.vn`: chứng chỉ ACM ở us-east-1, DNS ở tenten.vn. Trình duyệt không gửi cookie của `tripflix.io.vn` cho `*.cloudfront.net`, nên web cần tên miền này.
  - Hai behavior `*.m3u8` và `*.ts` riêng cho video. Ảnh vẫn công khai.
  - Key group `tripflix-playback`. Khoá riêng tạo và chỉ nằm trên VM.
  - Script chạy lại an toàn: `setup-media-domain.sh`, `add-playback-key.sh`, `set-video-lock.sh on|off`, kèm runbook trong README.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Liệt kê host trình duyệt gọi trên staging | Có | Bảng ở mục Bối cảnh |
| Media đi qua tên miền của Tripflix | Có | `media.tripflix.io.vn` → CloudFront, chứng chỉ `CN=media.tripflix.io.vn`; ảnh và video trả 200 |
| Video chỉ mở được khi có cookie ký | Chưa | Chờ app và web gửi cookie rồi mới `set-video-lock.sh on` |
| Báo kết quả cho cả nhóm | Chưa | Sau khi bật khoá |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 tác vụ đạt. core-api 2610 test đạt, 4 test bị bỏ qua sẵn từ trước.
- Test mới:
  - `playback-policy.spec.ts`: 2 test.
  - `cloudfront-playback-cookie-signer.spec.ts`: 2 test, kiểm lại chữ ký bằng public key như CloudFront kiểm.
  - `media-playback.use-cases.spec.ts`: 3 test.
  - `media-playback.e2e.spec.ts`: 4 test, gồm Set-Cookie cho trình duyệt, không Set-Cookie cho app, và chưa có khoá.
  - `env.spec.ts`: 3 test.
- `pnpm contracts:build`: thêm `/api/media/playback-session` và `PlaybackSessionDto`.
- Script AWS: chạy với một lệnh `aws` giả, đạt đủ các trường hợp:
  - tạo lần đầu;
  - chạy lại khi đã đúng thì không đổi gì;
  - khoá rồi chạy lại script tên miền vẫn giữ khoá;
  - thêm cùng khoá hai lần không tạo trùng;
  - xoay khoá;
  - đưa nhầm khoá riêng thì bị từ chối;
  - tắt khoá.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/media src/platform/env.spec.ts`
2. Sau khi deploy và điền khoá (README `deploy/aws`, bước 4): `curl -s -X POST https://api.tripflix.io.vn/api/media/playback-session` phải trả `cookies` có 3 khoá `CloudFront-*`.
3. Sau `set-video-lock.sh on`: `curl` một file `.m3u8` không kèm cookie phải trả 403; gửi kèm header Cookie từ bước 2 thì trả 200.

## Giới hạn
- Ai cũng gọi được endpoint, nên người cố tình cào video vẫn lấy được cookie. Việc khoá chặn được ba thứ: link bị chép hay nhúng ở trang khác, link sống mãi, và người ngoài dùng ké băng thông. Chặn cào cần đăng nhập hoặc giới hạn theo thiết bị, để task khác.
- Trên Android, `expo-video` gắn cache video với giá trị cookie, nên khoảng 6 giờ cache phải tải lại một lần.
- Chưa làm: API vẫn gọi được bằng IP của VM; web thiếu security header (TF64); bucket policy template chưa có `staging/*`.

## Ảnh hưởng tới phần của người khác
- `apps/core-api/src/platform/env.ts`, `env.spec.ts`: chỉ thêm biến và test, không sửa biến cũ.
- `pnpm-workspace.yaml` (cấu hình chung, Tech Lead): thêm một dòng catalog cho thư viện mới.
- Phần app (Trang) và web (Thành) nằm ở PR FE riêng.
