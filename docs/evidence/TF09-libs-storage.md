# TF09 — Phần 2: libs/storage

- Notion: TF09 · Nhánh: `phong/TF09-libs-storage` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-04

PR này là một phần của TF09, nên chưa đạt hết tiêu chí của task. API upload làm ở PR sau.

## Đã làm
- Thêm interface `ObjectStorage`, adapter S3 và adapter bộ nhớ, vì `content/media` và `video-worker` đều cần đọc, ghi S3 và test không được phụ thuộc mạng.
- Tắt checksum CRC32 mặc định của AWS SDK, vì app không gửi được checksum đó khi PUT lên link ký sẵn.
- Chỉ ghép tiền tố môi trường một lần qua `resolveKey`, để `video-worker` đọc đúng khoá nhận từ sự kiện.
- Đổi lỗi S3 sang `UploadExpiredError`, `UploadIncompleteError`, `ObjectNotFoundError` để API trả đúng mã lỗi; các lỗi S3 khác giữ nguyên.
- Thêm `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`: thư viện chính thức của AWS cho upload nhiều phần và ký link. Phong đã đồng ý.

## Đối chiếu tiêu chí
| Tiêu chí của phần này | Đạt | Bằng chứng |
|---|---|---|
| Ký link tải từng phần, không kèm checksum | Có | `s3-object-storage.spec.ts`; bỏ cấu hình đi thì test fail |
| Hoàn tất upload và báo đúng lỗi | Có | `s3-object-storage.spec.ts`, `in-memory-object-storage.spec.ts` |
| Test chạy không cần mạng | Có | Các spec không gọi S3 thật |
| Chạy với S3 thật | Chưa | Chưa thử với bucket dev |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test build --affected`: 40/40 task đạt; test storage 18/18, core-api 18/18, auth 14/14, notification-service 4/4, config 2/2, contracts 2/2.
- `pnpm audit --prod --audit-level high`: không có lỗ hổng đã biết.

## Cách kiểm lại
1. `pnpm install`.
2. `pnpm turbo run lint typecheck test build --filter=@tripflix/storage`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- `pnpm-workspace.yaml`, `pnpm-lock.yaml` (cấu hình chung): chỉ thêm 2 thư viện vào catalog, cần Tech Lead xem.
- Chưa có app nào dùng `@tripflix/storage`.
