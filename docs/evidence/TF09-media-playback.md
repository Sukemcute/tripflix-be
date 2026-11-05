# TF09 — Phần 9: nhận kết quả chuyển mã và thông tin phát video

- Task: TF09 (SCRUM-13) · Nhánh: `phong/TF09-media-playback` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-05

Sau PR này backend có đủ luồng từ upload tới link phát. App chưa xem được video vì chưa có API của bài đăng hay bảng tin trả link phát.

## Đã làm
- `MediaResultConsumer`: consumer group mới `core-media` đọc `stream:media`, chỉ chạy khi `APP_ROLE` là `worker` hoặc `all`.
- `media.rendition.completed`: thêm dòng vào `renditions`. Mức 360p thì chuyển `ready`, lưu `hls_prefix`, thời lượng, tỷ lệ, phát `content.media.ready` qua outbox trong cùng transaction.
- `media.transcode.failed`: chưa có 360p thì chuyển `failed` và phát `content.media.failed`; đã có 360p thì giữ `ready`, chỉ ghi lỗi để xem lại.
- Worker có thể báo lại, nên thêm mức dùng `ON CONFLICT DO NOTHING`, đổi trạng thái dùng `WHERE status = 'processing'`, và chỉ lần đổi được mới phát sự kiện. Kết quả của video không tồn tại thì bỏ qua để không kẹt hàng đợi.
- `MediaFacade.getPlayback(assetIds)`, `getStatus(assetId)`, xuất qua `content/index.ts`. `getPlayback` chỉ trả video `ready`. `getStatus` trả `null` khi không có video, đã cập nhật file 09.
- Thêm schema `content.media.ready`, `content.media.failed` vào `libs/contracts`.

## Đối chiếu tài liệu (docs/09, mục Kết quả từ worker và Hàm cho module khác)
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| 360p xong thì `ready`, phát `content.media.ready` một lần | Có | Int test trên Postgres, Redis thật; thử thật toàn luồng |
| Loại trùng theo `(assetId, mức)` | Có | Int test gửi 360p hai lần |
| 360p lỗi thì `failed`, phát `content.media.failed` | Có | Int test `360p lỗi...` |
| Mức cao lỗi thì giữ `ready`, ghi lỗi | Có | Int test `mức cao lỗi sau 360p...` |
| Rollback khi ghi outbox lỗi | Có | Int test `ghi outbox lỗi thì rollback...` |
| `getPlayback` trả link, 3 ảnh bìa, các mức | Có | `media-result.use-cases.spec.ts`, int test |

## Kết quả kiểm tra
Chạy đủ các bước của CI, tất cả thoát mã 0:
- `pnpm lint` (có kiểm ranh giới module): 23/23 task.
- `pnpm typecheck`: 23/23 task.
- `pnpm test`: 23/23 task; core-api 301/301 test.
- `pnpm test:int`: 16/16 task; core-api 48/48 test.
- `pnpm build`: 13/13 task.
- `pnpm contracts:build`: thêm 2 schema sự kiện, đã commit.

Thử thật toàn luồng với core-api, video-worker, S3 `dev/phong/`, CloudFront, Postgres và Redis local: 10/10 đạt, đã dọn dữ liệu thử. Gọi API upload và `complete`, video tự chuyển `ready` sau 13 giây, có đủ 360p, 540p, phát đúng 1 `content.media.ready`, đọc và giải mã được HLS qua CloudFront.

## Chưa làm, giới hạn
- `getPlayback` chưa có API HTTP theo file 10: phần bài đăng hoặc bảng tin sẽ gọi hàm này. Trong lần thử thật, link phát được ghép từ `hls_prefix`; bản thân hàm được kiểm bằng int test.
- `social` chưa nghe `content.media.ready`, nên bài đăng chưa tự chuyển trạng thái theo video.
- Chưa thử phát trên điện thoại thật và chưa thử video HDR của iPhone.
- Tên group `core-media` chờ Dũng xác nhận.

## Cách kiểm lại
1. `pnpm install && pnpm build`.
2. `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/media`.
3. `pnpm test:int`, cần Docker.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `libs/event-bus` của Dũng thêm group `core-media`; `libs/contracts` của Dũng thêm 2 schema, tương thích ngược.
- Có: `content.module.ts`, `content/index.ts` (chung với Thành) thêm export `MediaModule`, `MediaFacade`; không đổi code của `social`.
- Có: `notification-service` sẽ nhận thêm `content.media.ready`, `content.media.failed` trên `stream:core.content` và chỉ ghi log như các sự kiện chưa có việc.
