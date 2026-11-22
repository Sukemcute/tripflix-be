# TF09 — Phần 6: CloudFront đọc thêm thư mục ảnh

- Task: TF09 (SCRUM-13) · Nhánh: `phong/TF09-cdn-images` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- Bucket policy cho CloudFront đọc thêm `dev/*/images/*`, vì ảnh khách sạn mock của `commerce` sẽ để trên S3 và đọc qua CloudFront. Trước đó chỉ đọc được `dev/*/videos/*`.
- Thư mục `uploads/` vẫn không đọc được qua CloudFront, để file gốc không phát công khai.
- Cập nhật README và dòng thông báo của `setup-dev-media.sh`.

## Kết quả kiểm tra
Policy đã áp dụng thật trong CloudShell. Thử thật qua CloudFront bằng file tạm trong `dev/phong/`, xoá sau khi thử:

| Thư mục | Mong đợi | Thực tế |
|---|---|---|
| `images/` | 200 | 200 |
| `videos/` | 200 | 200 |
| `uploads/` | 403 | 403 |

Chạy `setup-dev-media.sh` với `aws` giả để xem policy sinh ra từ template: JSON hợp lệ, có đúng 2 đường dẫn `videos/` và `images/`, không có `uploads/`. Chưa chạy lại script này trên AWS thật; policy được áp dụng bằng lệnh `put-bucket-policy` với cùng nội dung.

Chạy đủ các bước của CI, tất cả thoát mã 0:
- `pnpm lint` (có kiểm ranh giới module): 22/22 task.
- `pnpm typecheck`: 22/22 task.
- `pnpm test`: 22/22 task.
- `pnpm test:int`: 12/12 task.
- `pnpm build`: 13/13 task.
- `pnpm contracts:build`: `contracts/` không đổi.

## Cách kiểm lại
1. Tải một file thử lên `dev/<tên>/images/`, đọc qua CloudFront: mong đợi 200.
2. Tải một file thử lên `dev/<tên>/uploads/`, đọc qua CloudFront: mong đợi 403.
3. Xoá các file thử.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `deploy/aws` thuộc `deploy/` của Dũng, README của thư mục này ghi Phong phụ trách. Phục vụ phần ảnh của Thắng (`commerce`). Quyền đọc video không đổi.
