# TF33: gỡ bài bị ẩn khỏi chỉ mục tìm kiếm trong vài giây (phần discovery)

- Jira: SCRUM-37 · Nhánh: `duy/TF33-xoa-bai-an-khoi-search` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-09

## Đã làm
- Trước đây bài bị ẩn/xoá vẫn nằm trong `discovery.search_documents` tới lượt job dựng lại kế tiếp (tối đa 10 phút). Nội dung bài không lộ (`/search` lọc lại qua `getVisiblePosts`), nhưng `sections[].total` vẫn đếm bài đó.
- Consumer group `core-discovery` (`search/consumers/explore-content.consumer.ts`) nghe `content.post.moderated`, `content.post.deleted`, `content.post.updated` trên `stream:core.content`, gọi `ExploreUseCases.dropHidden([postId])`.
- `dropHidden(postIds)` hỏi lại `getVisiblePosts`, bài nào không còn hiện thì xoá `post:<id>` khỏi `search_documents` (`ExploreStore.deleteDocuments`). Không đọc `action` trong payload nên event cũ, trùng hoặc lệch thứ tự (hide rồi restore) không xoá nhầm bài đang hiện; gọi lại nhiều lần vẫn cho cùng kết quả, không cần lưu eventId. Lỗi quá 5 lần thì thư viện chuyển sang `stream:dead-letter`.
- `rebuildIndex` gọi `dropHidden` cho mọi bài ngay sau khi `replaceAll` commit: bài bị ẩn trong lúc job đang dựng (job đọc lúc bài còn hiện rồi ghi lại, lượt xoá của consumer có thể hụt vì đụng transaction) vẫn bị gỡ ngay. Bước này lỗi thì chỉ ghi log, chỉ mục mới vẫn giữ.
- Không sửa `search_counts`, không thêm lại bài khi restore: job 10 phút làm việc đó.
- `content.post.updated` (đổi bài sang riêng tư) có trên nhánh `thanh/TF33-outbox-post-updated`, chưa vào `develop`; consumer đã nghe sẵn.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Jira) | Đạt | Bằng chứng |
|---|---|---|
| Bài bị ẩn biến mất khỏi app, web và trợ lý trong vài giây | Một phần: phần tìm kiếm của discovery. Bảng tin (Phong), trợ lý AI (Bảo) và việc đo thời gian trên stack thật chưa làm ở nhánh này | `explore.use-cases.spec.ts` (nhóm "TF33"), `explore-content.consumer.spec.ts` |
| Bài ẩn không lộ trong kết quả `/search` | Đạt (có từ TF11) | `explore.use-cases.spec.ts`: "tìm theo nơi, ngân sách; bài bị ẩn không lọt ra kết quả" |
| `total` hết đếm bài ẩn ngay khi gỡ | Đạt | Test "ẩn bài rồi dropHidden: total giảm ngay, gọi lại vẫn vậy" |
| Bài bị ẩn lúc job đang dựng không bị ghi lại | Đạt | Test "bài bị ẩn sau lúc job đọc mà bị ghi lại vẫn bị gỡ ngay sau khi dựng xong" |
| Thử lại, quá 5 lần vào dead-letter | Đạt (thư viện `libs/event-bus`, `maxDeliveries = 5`) | `libs/event-bus/src/consumer.ts` |

## Kết quả kiểm tra
`pnpm turbo run lint typecheck test --affected` (2026-11-09): 49/49 task pass. `core-api`: 61 file, 676 test pass, 1 bỏ qua (có sẵn). Lint 0 lỗi, không có cảnh báo trong file của task.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/discovery/search`
2. Trên stack (`pnpm stack:up`, `APP_ROLE=all` hoặc `worker`): tìm `POST /api/search` một câu ra bài X, ghi `total`; admin ẩn X; sau vài giây tìm lại, `total` giảm 1. Log worker có dòng "Đã gỡ bài X khỏi chỉ mục tìm kiếm".

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không sửa code ngoài `discovery`. Đọc stream `core.content` do content (Thành) phát; chỉ dùng `postId` trong payload.
- Chưa có schema `content.post.*` trong `contracts/` (ghi ở `docs/prd-alignment.md` C23 của workspace, việc của Thành).
