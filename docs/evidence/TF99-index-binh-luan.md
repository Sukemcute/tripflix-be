# TF99 — Index một phần cho trang bình luận, cursor so theo cặp (mục 2.3, S2)

- Notion: TF99 · Nhánh: `thanh/TF99-index-binh-luan` (phụ thuộc PR #236, #235) · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- Thêm 2 index một phần cho `content.comments` (schema Drizzle và migration `20261117065054_comments_page_indexes`):
  - `idx_comments_post_root_created`: `(post_id, created_at DESC, id DESC, status, author_id) WHERE parent_comment_id IS NULL AND deleted_at IS NULL`.
  - `idx_comments_parent_created`: `(parent_comment_id, created_at DESC, id DESC, status, author_id) WHERE deleted_at IS NULL`.
- Lý do chọn cột:
  - `created_at DESC, id DESC` đúng thứ tự trang, nên Postgres đọc đúng 21 dòng và không phải sắp xếp lại.
  - Index chỉ gồm dòng chưa xoá, và index gốc bỏ trả lời ra, nên không phải lọc qua các dòng đó.
  - `status, author_id` đặt cuối để câu đếm tổng (lọc theo trạng thái hiển thị) chỉ cần đọc index. Postgres có `INCLUDE` nhưng Drizzle chưa hỗ trợ.
  - Ghi rõ `NULLS FIRST`: drizzle-kit mặc định sinh `DESC NULLS LAST`, không khớp với `ORDER BY … DESC` của Postgres, nên Postgres không dùng được thứ tự của index.
- `keyset-cursor.ts` so theo cặp `(created_at, id) < (x, y)` thay cho `(t < x) OR (t = x AND id < y)`.
  - Dạng cặp cho Postgres bắt đầu quét index ngay từ cursor.
  - Dạng OR chỉ lọc sau khi quét: với index mới, trang cuối lọc bỏ 7.980 dòng (4 ms).
  - Đổi cả trang bài viết, bài đã lưu và đồng bộ, vì cùng dùng hàm này. Ý nghĩa không đổi và các test cũ vẫn pass.
- Giữ nguyên 3 index cũ, vì còn câu dùng (ví dụ ẩn chuỗi trả lời theo `parent_comment_id` không lọc `deleted_at`). Gỡ index thừa để làm việc riêng sau khi đo trên dữ liệu thật.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Mỗi trang đọc ≤ 21 dòng | Đạt | R2 bên dưới: trang 1 đọc 21 trang dữ liệu, lọc bỏ 0 dòng (trước: 258 trang dữ liệu, lọc bỏ 232 dòng). Test "trang sâu của bình luận gốc" kiểm kế hoạch thật: dùng `idx_comments_post_root_created`, đọc 21 dòng, không lọc, không sắp xếp. Đổi lại cursor dạng OR thì test fail |
| Phân trang không thiếu, không lặp | Đạt | `keyset-cursor.int.spec.ts` (bình luận, bài viết, bài đã lưu, đồng bộ, nhiều dòng cùng mili giây) 6/6 |
| Index có trong schema Drizzle cùng migration (anh Phong, Trang dặn) | Đạt | `db/schema/comments.ts` và migration sinh bằng `pnpm db:generate content` |

## R2 (EXPLAIN ANALYZE, bài 10.000 bình luận, trung vị 3 lần)
Đo bằng `tools/bench/comments/explain.sql` (PR #239). Index tạo trong transaction rồi rollback nên DB local không bị đổi.

| Câu | Trước | Sau |
|---|---|---|
| Trang 1 bình luận gốc | 258 trang dữ liệu · lọc bỏ 232 dòng · 0,32 ms | 21 · lọc 0 · 0,08 ms |
| Trang 2 (cursor dạng OR → dạng cặp) | 274 · lọc 257 · 0,15 ms | 23 · lọc 0 · 0,05 ms |
| Trang cuối (400) | 23 · 0,09 ms | 22 · 0,08 ms |
| Đếm bình luận gốc (mọi trang) | quét cả bảng · 705 trang dữ liệu · 3,5 ms | chỉ đọc index · 86 · 1,5 ms |
| Đếm trả lời của 20 bình luận | 294 · lọc 232 · 0,21 ms | 40 · 0,12 ms |

"Trang dữ liệu" là số khối 8 KB Postgres phải đọc (buffers).
- Trước khi sửa, trang càng sâu thì cursor dạng OR càng đọc lại nhiều dòng phía trước.
- Câu đếm vẫn là câu tốn nhất. Nó tăng theo số bình luận của bài, chỉ nhẹ hơn khoảng 8 lần. Bỏ hẳn câu đếm ở các trang sau thuộc S1, là việc riêng.

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 (core-api 2661 pass, 4 skip có sẵn).
- Test tích hợp content: 108/108, chạy 2 lần.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api db:migrate`.
2. `pnpm --filter @tripflix/core-api exec vitest run --config vitest.int.config.ts src/modules/content/social/infra/keyset-cursor.int.spec.ts`.
3. `bash tools/bench/comments/run.sh explain` (nhánh của PR #239), xem dòng `Index Scan using idx_comments_post_root_created`.

## Ảnh / video
- Không đính kèm.

## Ảnh hưởng tới phần của người khác
- `content/db` dùng chung (anh Phong, Trang): thêm 2 index và migration mới, đã báo và được đồng ý.
- `CREATE INDEX` không dùng `CONCURRENTLY`, vì migration chạy trong transaction, nên lúc tạo index sẽ chặn ghi bảng `comments`. Bảng hiện nhỏ nên chỉ chặn trong tích tắc. Khi bảng lớn thì cần tạo index tay bằng `CONCURRENTLY` trước khi chạy migration.
