# TF09 — Phần 5: relay outbox chọn stream theo từng sự kiện

- Task: TF09 (SCRUM-13) · Nhánh: `phong/TF09-outbox-relay-stream` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-05

PR này là một phần của TF09, chuẩn bị cho API `complete`. Chưa có module nào dùng hàm chọn stream.

## Đã làm
- `OutboxRelay`: `stream` nhận thêm dạng hàm `(envelope) => StreamName`, vì bảng `content.outbox_events` phải gửi việc chuyển mã vào `stream:media`, còn sự kiện khác của `content` vào `stream:core.content`.
- Hàm chọn stream chạy trong cùng `try` với lệnh gửi: hàm ném lỗi thì gọi `onError`, `markFailed`, dừng lô. Không có stream mặc định, để sự kiện chưa khai báo không đi nhầm stream.
- Mỗi sự kiện đi đúng một stream. README `libs/outbox` có hướng dẫn và mẫu.

## Đối chiếu yêu cầu của Dũng
| Yêu cầu | Đạt | Bằng chứng |
|---|---|---|
| `stream: StreamName \| ((envelope: EventEnvelope) => StreamName)`, relay của access giữ nguyên | Có | `relay.ts`; `access-outbox-relay.ts` không đổi, typecheck đạt |
| Hàm ném lỗi thì `onError`, `markFailed`, dừng lô, không có stream mặc định | Có | `relay.spec.ts > hàm ném lỗi thì báo onError, markFailed, sự kiện sau chưa gửi, không có stream mặc định` |
| Chia đúng 2 stream, giữ thứ tự trong từng stream, mỗi sự kiện đi một stream | Có | `relay.spec.ts > chia đúng 2 stream, giữ thứ tự trong từng stream, mỗi sự kiện đi một stream` |
| Cập nhật README `libs/outbox` | Có | `libs/outbox/README.md`, mục "Bật relay" |

## Kết quả kiểm tra
Chạy đủ các bước của CI, tất cả thoát mã 0:
- `pnpm lint` (có kiểm ranh giới module): 22/22 task.
- `pnpm typecheck`: 22/22 task.
- `pnpm test`: 22/22 task; outbox 9/9 (2 test mới), core-api 130/130.
- `pnpm test:int`: 12/12 task; core-api 12/12.
- `pnpm build`: 13/13 task.
- `pnpm contracts:build`: `contracts/` không đổi.

Chưa thử với Redis thật bằng hàm chọn stream; sẽ thử khi `complete` nối relay của `content`.

## Cách kiểm lại
1. `pnpm install`, rồi `pnpm --filter @tripflix/outbox test`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `libs/outbox` (`relay.ts`, `relay.spec.ts`, `README.md`), chủ là Dũng. Đã báo và Dũng đồng ý cho Phong sửa, nêu rõ các yêu cầu ở bảng trên. Thay đổi tương thích ngược, relay của `access` không phải sửa.
