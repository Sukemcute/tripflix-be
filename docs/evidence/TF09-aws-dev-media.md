# TF09 — Phần 3: bucket S3 và CloudFront dev

- Notion: TF09 · Nhánh: `phong/TF09-aws-dev-media` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-04

PR này là một phần của TF09, nên chưa đạt hết tiêu chí của task. API upload làm ở PR sau.

## Đã làm
- Tạo bucket `tripflix-media-dev`, CloudFront `E82GXSZ0QET03` và IAM user `tripflix-dev-phong` bằng script trong `deploy/aws/`, để các thành viên khác dùng chung hạ tầng và tái tạo được.
- Đổi vùng sang `ap-southeast-2` trong `.env.example`, `compose.yaml`, docs/11, vì SCP của tổ chức AWS chặn tạo bucket ở `ap-southeast-1`.
- CloudFront chỉ đọc `dev/*/videos/*` để file gốc không phát công khai.
- Script không tạo access key, để key không hiện trên màn hình dùng chung.
- Cho thành viên quyền `s3:ListBucket` để file thiếu trả 404 như production. Đổi lại, mọi người xem được tên file của nhau trong bucket dev.

## Đối chiếu tiêu chí
| Tiêu chí của phần này | Đạt | Bằng chứng |
|---|---|---|
| Upload nhiều phần qua link ký sẵn | Có | Thử thật: PUT 2 phần, hoàn tất, dung lượng và nội dung khớp |
| Phát `videos/` qua CloudFront | Có | Thử thật: 200, giữ `Cache-Control`, `Content-Type`, có CORS |
| File gốc không phát công khai | Có | Thử thật: CloudFront và S3 không ký đều trả 403 |
| Key chỉ ghi được thư mục của mình | Có | Thử thật: ghi `dev/trang/` và `videos/` ở gốc đều bị `AccessDenied` |
| Bucket chặn công khai, có CORS, lifecycle | Có | Script áp dụng thành công; CORS đã thử thật, luật lifecycle chưa chờ tới lúc chạy |

## Kết quả kiểm tra
- Script tạm chạy `libs/storage` với S3 và CloudFront thật: 22/22 đạt, gồm cả 3 lỗi `UploadIncompleteError`, `UploadExpiredError`, `ObjectNotFoundError`. Đã xoá các file thử.
- Script `setup-dev-media.sh` chạy thành công trên AWS thật, chưa thử chạy lại trên AWS sau khi đã tạo đủ. Bản `aws` giả xác nhận chạy lại không tạo trùng và dừng khi lỗi.
- `create-dev-member.sh` mới chạy thật với `phong`.
- Chưa phát thử video HLS đầy đủ qua trình phát.

## Cách kiểm lại
1. Chép `deploy/.env.example` thành `deploy/.env`, điền `DEV_NAME` và key của mình.
2. Quản trị viên chạy `create-dev-member.sh <tên>` nếu chưa có user.
3. Xem cấu hình bucket: `aws s3api get-bucket-cors --bucket tripflix-media-dev`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- `deploy/.env.example`, `deploy/compose.yaml` (Dũng): đổi vùng mặc định, điền `MEDIA_CDN_URL`. Chưa có code nào dùng các biến này.
- `docs/architecture/11-de-xuat-cau-truc-repo.md` (Trang): đổi vùng trong ví dụ.
- Các thành viên khác cần được tạo user riêng rồi mới dùng được bucket.
