# Media dev trên AWS

Dev dùng bucket S3 thật, không dùng MinIO (docs/architecture/11 Q9). Phụ trách: Phong.

Cần tạo:

1. Bucket `tripflix-media-dev` (region `ap-southeast-1`), chặn truy cập công khai; CORS cho phép `PUT` từ app và web khi tải lên nhiều phần.
2. Lifecycle: xoá upload nhiều phần chưa xong sau 1 ngày.
3. CloudFront dev trỏ vào bucket (Origin Access Control), cache đoạn HLS theo `Cache-Control` của file.
4. Mỗi thành viên một IAM user, policy chỉ cho ghi và đọc `dev/<tên>/*` trên bucket dev. Key để trong `deploy/.env` của người đó, không commit.

Ghi cấu hình CORS, lifecycle, policy mẫu vào thư mục này khi tạo.
