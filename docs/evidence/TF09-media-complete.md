# TF09 — Phần 7: API hoàn tất upload và giao việc chuyển mã

- Task: TF09 (SCRUM-13) · Nhánh: `phong/TF09-media-complete` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-05

PR này là một phần của TF09. Chưa phát được video: còn `video-worker`, phần nhận kết quả và `getPlayback`.

## Đã làm
- `POST /api/media/uploads/:assetId/complete`: ghép file trên S3, kiểm dung lượng, chuyển `processing`, ghi `content.media.transcode_requested` vào outbox, trả 202.
- Gọi S3 ngoài transaction; đổi trạng thái và ghi outbox trong cùng `@Transactional('content')`.
- Kiểm request có đủ mọi phần trước khi gọi S3, vì S3 sẽ ghép thiếu rồi xoá phiên upload, khiến app không tải tiếp được.
- Gọi lại an toàn: `UPDATE ... WHERE status = 'uploading'` nên nhiều lần gọi chỉ một lần được giao việc. S3 báo mất phiên thì xem file gốc trước khi trả 410, vì lần trước có thể đã ghép xong nhưng ghi database lỗi.
- `revision` lấy từ `transcode_attempts` sau khi tăng, bắt đầu từ 1.
- Thêm bảng `content.outbox_events` và relay `ContentOutboxRelay` với hàm chọn stream của PR #21. Relay đặt trong `media/infra` để không sửa provider của `social`.
- Thêm schema `ContentMediaTranscodeRequestedV1Schema` vào `libs/contracts`.

## Đối chiếu kế hoạch
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| 202 `processing`, ghi đúng một việc chuyển mã | Có | E2E `trả 202 processing...`; thử thật |
| Rollback trạng thái khi ghi outbox lỗi | Có | Int test `ghi outbox lỗi thì rollback trạng thái...` trên Postgres thật |
| Gọi lại sau khi S3 đã ghép xong vẫn thành công | Có | Int test như trên; thử thật với S3 |
| Nhiều lần gọi cùng lúc chỉ một sự kiện | Có | Int test `nhiều lần gọi cùng lúc...` |
| Đi đúng `stream:media`, không đi nhầm `stream:core.content` | Có | Int test relay; thử thật với Redis |
| 404, 409, 410, 400, 401 | Có | E2E; thử thật với S3 cho 404, 409, 410 |

## Kết quả kiểm tra
Chạy đủ các bước của CI, tất cả thoát mã 0:
- `pnpm lint` (có kiểm ranh giới module): 22/22 task.
- `pnpm typecheck`: 22/22 task.
- `pnpm test`: 22/22 task; core-api 238/238 test.
- `pnpm test:int`: 12/12 task; core-api 21/21 test.
- `pnpm build`: 13/13 task.
- `pnpm contracts:build`: thêm route `complete` và schema sự kiện mới, đã commit.

Thử thật với core-api chạy `APP_ROLE=all`, S3 `dev/phong/`, Postgres và Redis local: 16/16 đạt, đã dọn dữ liệu thử. S3 thật từ chối ETag sai và trả đúng lỗi khi phiên upload đã huỷ.

## Chưa làm, cần chốt
- **`pnpm db:generate content` đang lỗi từ trước PR này:** `init_media` và `plain_captain_cross` đều là snapshot gốc. Cách sửa cần đổi snapshot của migration đã merge nên chưa làm ở đây. Migration chạy bình thường vì migrator chỉ đọc SQL.
- **`Idempotency-Key`:** API này chưa nhận header, vì đã an toàn khi gọi lại nhờ kiểm trạng thái. `RULES.md` mục 10 yêu cầu nhận header với lệnh ghi có thể bị gửi lại, nên cần Dũng xác nhận. `POST /media/uploads` cũng chưa nhận header.
- Dung lượng sai sau khi đã ghép thì video giữ `uploading`, app phải tạo upload mới; file gốc tự xoá sau 7 ngày.

## Cách kiểm lại
1. `pnpm install && pnpm build`.
2. `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/media`.
3. `pnpm test:int`, cần Docker.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `content/db` (chung với Thành, Trang) thêm bảng `outbox_events`; không đổi bảng có sẵn.
- Có: `libs/contracts` của Dũng thêm một schema, tương thích ngược.
- Có: hợp đồng API với mobile của Trang: `complete` có thể trả `status: 'ready'` khi gọi lại và thêm lỗi `409 MEDIA_UPLOAD_NOT_ACTIVE`.
