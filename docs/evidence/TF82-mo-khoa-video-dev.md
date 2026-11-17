# TF82 — Mở khoá video cho máy dev

- Nhánh: `phong/TF82-mo-khoa-dev` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- Thắng báo: từ khi bật khoá video (TF82), core-api chạy local không có `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY`, `POST /api/media/playback-session` trả cookie rỗng, `.m3u8` và `.ts` bị 403. Nguyên nhân: khoá gắn vào behavior `*.m3u8`, `*.ts` của cả distribution, mà local dùng chung distribution (`MEDIA_CDN_URL` trong `.env.example`), nên video `dev/<tên>/` cũng bị khoá.
- `deploy/aws/set-dev-video.sh open|close` và `dev-video.jq`: thêm hoặc gỡ behavior `dev/*` chép từ behavior mặc định (công khai, `Managed-SimpleCORS`), đặt đầu danh sách. Video `staging/*` vẫn khoá. Chạy lại an toàn.
- `media-domain.jq`: giữ `dev/*` đứng trước behavior video, để chạy lại `setup-media-domain.sh` không khoá lại video dev.
- `deploy/aws/README.md`: thêm bước 7.
- Không cấp khoá dev: key group tin mọi khoá như nhau, khoá dev ký được cookie xem cả video staging, và khoá riêng sẽ nằm trên máy cả team.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Local không có khoá vẫn phát được video `dev/` | Chờ chạy trên AWS | `curl` `.m3u8` dưới `dev/` ra 200 |
| Video staging vẫn khoá | Chờ chạy trên AWS | `curl` `.m3u8` dưới `staging/` không cookie ra 403 |
| Chạy lại hoặc chạy các script TF82 khác không phá cấu hình | Đạt | Thử jq trên cấu hình mẫu, xem dưới |

## Kết quả kiểm tra
Thử jq trên một cấu hình mẫu giống distribution hiện tại (behavior `*.m3u8`, `*.ts` đang khoá):
- `open`: thứ tự `dev/*` (không khoá, SimpleCORS), `*.m3u8`, `*.ts` (khoá, CORS video). Chạy `open` lần hai: không đổi.
- `close` sau `open`: giống hệt cấu hình ban đầu.
- `media-domain.jq` sau `open`: giữ `dev/*` ở đầu. Khi chưa `open`: không đổi so với trước.
- `video-lock.jq` và `video-cors.jq` sau `open`: chỉ đổi `*.m3u8`, `*.ts`, không đụng `dev/*`.
- `bash -n set-dev-video.sh`: đạt.

## Cách kiểm lại
1. CloudShell: `./set-dev-video.sh open`, rồi `aws cloudfront wait distribution-deployed --id <id>`.
2. `curl -so /dev/null -w '%{http_code}\n' https://media.tripflix.io.vn/dev/<tên>/.../index.m3u8` ra 200; một file dưới `staging/` không cookie ra 403.
3. core-api local không có `CLOUDFRONT_*`, mở Reels trên app: video phát được.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `deploy/aws/` (Phong).
