# TF64 — CORS video cho Admin

- Nhánh: `phong/TF64-cors-admin` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-20

## Đã làm
- Trang báo: màn kiểm duyệt trên `https://admin.tripflix.io.vn` không phát được video. Admin phát HLS kèm cookie CloudFront, mà policy `tripflix-video-cors` chỉ có origin `https://tripflix.io.vn`, nên với origin Admin CloudFront trả 200 nhưng không có `Access-Control-Allow-Origin` và trình duyệt chặn.
- `setup-video-cors.sh`: `WEB_ORIGINS` mặc định thêm `https://admin.tripflix.io.vn`, để chạy lại script không xoá origin Admin. Policy đã gắn sẵn cho `*.m3u8`, `*.ts`, `dev/*.m3u8`, `dev/*.ts` (`video-cors.jq`), không đổi behavior.
- README bước 5: ghi hai origin mặc định, cách kiểm theo từng origin.
- Admin vẫn xem video qua CloudFront; worker trích frame và OCR đọc file gốc thẳng từ S3, không qua policy này.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Origin Admin nhận header CORS cho `.m3u8`, playlist, `.ts` | Đạt | Sau khi chạy script (20/11): `master.m3u8`, `360p/index.m3u8`, `360p/seg_000.ts` với origin Admin đều 200, `access-control-allow-origin: https://admin.tripflix.io.vn`, `access-control-allow-credentials: true`. Trước khi sửa (20/11): `curl -sI -H 'Origin: https://admin.tripflix.io.vn' .../dev/thang/videos/0d24949f-.../r1/master.m3u8` ra 200, không có `access-control-allow-origin`; cùng URL với `https://tripflix.io.vn` có đủ header |
| Origin web vẫn đúng | Đạt | Cùng 3 file với `https://tripflix.io.vn`: 200, trả đúng origin kèm credentials |
| Chạy lại script không mất origin Admin | Đạt | Mặc định của `WEB_ORIGINS` có cả hai origin; `jq` dựng `AccessControlAllowOrigins` ra `Quantity: 2` |

## Kết quả kiểm tra
- `bash -n deploy/aws/setup-video-cors.sh`: đạt.
- CloudShell: `WEB_ORIGINS="https://tripflix.io.vn,https://admin.tripflix.io.vn" ./setup-video-cors.sh`, policy có 2 origin.
- `curl -sI -H 'Origin: <origin>'` 3 file × 2 origin: 6/6 đạt.

## Cách kiểm lại
1. CloudShell: `./setup-video-cors.sh`, in "Đã cập nhật policy tripflix-video-cors".
2. Sau vài phút: `curl -sI -H 'Origin: https://admin.tripflix.io.vn' <link .m3u8>` có `access-control-allow-origin: https://admin.tripflix.io.vn`, `access-control-allow-credentials: true`; lặp lại với playlist 360p, một đoạn `.ts` và origin `https://tripflix.io.vn`.
3. Admin: xoá cache trình duyệt của trang (đoạn `.ts` cache 1 năm), mở màn kiểm duyệt, video phát được.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `deploy/aws/` (Phong), theo yêu cầu của Trang.
