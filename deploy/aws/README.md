# Media dev trên AWS

Dev dùng bucket S3 thật, không dùng MinIO (docs/architecture/11 Q9). Phụ trách: Phong.

- Bucket: `tripflix-media-dev`, vùng `ap-southeast-2`. Chính sách SCP của tổ chức AWS chặn tạo bucket ở `ap-southeast-1`.
- CloudFront: `E82GXSZ0QET03`, domain `d399hxccn6y84z.cloudfront.net`.

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
| `lifecycle.json` | Xoá upload dở sau 1 ngày, file gốc trong `dev/<tên>/uploads/` sau 7 ngày | Theo docs Feed. Có thành viên mới thì thêm một luật |
| `bucket-policy.template.json` | CloudFront chỉ đọc `dev/*/videos/*` | File gốc không phát công khai |
| `cloudfront-distribution.template.json` | Chỉ HTTPS, cache theo `Cache-Control` của file, CORS cho web | `master.m3u8` cache 60 giây, còn đoạn video cache 1 năm |
| `iam-dev-member-policy.template.json` | Ghi và đọc `dev/<tên>/*`, liệt kê bucket | Có `s3:ListBucket` thì file thiếu trả 404 như production, nên `libs/storage` báo đúng lỗi |
