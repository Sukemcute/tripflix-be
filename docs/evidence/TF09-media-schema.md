# TF09 — Phần 1: bảng media_assets và renditions

- Notion: TF09 · Nhánh: `phong/TF09-media-schema` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-04

PR này chỉ là phần đầu của TF09, nên chưa đạt hết tiêu chí của task. API upload và `libs/storage` làm ở PR sau.

## Đã làm
- Thêm bảng `content.media_assets` và `content.renditions` vì API upload và `video-worker` đều cần chúng.
- Để bảng trong `db/schema/media.ts`, tách `contentSchema` sang `content-schema.ts`. Schema `content` có 3 người dùng chung, nên mỗi phần con một file sẽ ít xung đột; tách `contentSchema` để tránh import vòng.
- Ngoài các cột trong docs Feed, thêm `mime_type`, `file_size_bytes`, `source_key` để đối chiếu dung lượng khi hoàn tất upload và biết khoá file gốc.
- Không có cột ảnh bìa, vì ảnh bìa nằm trong thư mục phiên bản `r{n}`, suy ra được từ `hls_prefix`.
- Giới hạn video 5 phút không đặt ở database mà sẽ kiểm ở tầng nghiệp vụ.
- `s3_upload_id` được để trống, cho video mẫu nạp sẵn không đi qua upload nhiều phần.
- Sửa dòng đầu migration thành `CREATE SCHEMA IF NOT EXISTS`, vì init Postgres đã tạo schema, giống migration của `access`.

## Đối chiếu tiêu chí
| Tiêu chí của phần này | Đạt | Bằng chứng |
|---|---|---|
| Có 2 bảng, chủ bảng là `tf_content` | Có | `pg_tables`: `media_assets`, `renditions` thuộc `tf_content` |
| Module khác không đọc được | Có | `has_table_privilege('tf_access', 'content.media_assets', 'select')` trả về `f` |
| Ràng buộc chặn dữ liệu sai | Có | 13/13 kiểm tra đạt, xem bên dưới |
| Migration chạy lại không lỗi | Có | Chạy `db:migrate` 2 lần đều thành công |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 33/33 task đạt, 0 lỗi lint; test core-api 18/18, auth 14/14, notification-service 4/4, config 2/2, contracts 2/2.
- `db:migrate` thật trên Postgres local: `access`, `content` đều migrate xong.
- `db:generate content` chạy lại: không còn khác biệt giữa schema và migration.
- Script tạm chạy bằng `tf_content` trong transaction rồi ROLLBACK, 13/13 đạt: giá trị mặc định, chủ bảng, chặn sai `status`, `mime_type`, dung lượng, thời lượng, `aspect`, `level`, chặn `ready` khi thiếu thông tin phát, chặn trùng mức, chặn asset không tồn tại, chấp nhận `ready` đủ thông tin, xoá asset kéo theo `renditions`.
- Chưa có test tự động cho các ràng buộc này trong repo. Chưa có logic nghiệp vụ nên chưa thêm test mới.

## Cách kiểm lại
1. `pnpm install`, rồi `pnpm turbo run build --filter=@tripflix/core-api...`.
2. Máy đã dựng database trước TF05 chạy `GRANT CREATE` một lần theo `docs/evidence/TF05-xac-thuc-dang-nhap-bang-jwt.md`.
3. `pnpm --filter @tripflix/core-api db:migrate`.
4. Xem bảng: `\dt content.*` trong database `core`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- `content/db` dùng chung với Thành và Trang: `db/schema/index.ts` vẫn export `contentSchema` như cũ. Migration cần cả Phong, Thành, Trang duyệt theo README của module.
- Chưa có code nào khác dùng `contentSchema`.
