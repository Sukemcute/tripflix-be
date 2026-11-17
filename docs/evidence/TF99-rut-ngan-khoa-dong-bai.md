# TF99 — Rút ngắn thời gian giữ khoá dòng bài (mục 2.4, bước 1)

- Jira: TF99 · Nhánh: `thanh/TF99-rut-ngan-khoa-dong-bai` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
Vẫn giữ `SELECT … FOR UPDATE` dòng bài và thứ tự "khoá bài trước" (Trang thêm ở `08121fe` để ẩn, xoá cả luồng không bị chen trả lời; xoá bình luận và kiểm duyệt cũng khoá bài trước), chỉ bớt việc làm trong lúc giữ khoá:
- **Thêm bình luận:** đọc bài, tìm bình luận cha và gốc, tra tên (gọi sang access) làm trước khi khoá. Câu đầu transaction vừa khoá vừa cộng đếm (`UPDATE … RETURNING`); sau khi khoá kiểm lại bài và gốc (có thể vừa bị ẩn, xoá), không đạt thì rollback cả phần cộng đếm. Bình luận bị giữ chờ duyệt chỉ khoá, không cộng.
- **Thả tim:** cộng trừ đúng phần thay đổi (loại cũ −1, loại mới +1) từ dòng bài đã khoá, bỏ `count(*)` mọi cảm xúc của bài trong lúc giữ khoá.
- **Lưu bài:** `INSERT … ON CONFLICT DO NOTHING RETURNING` / `DELETE … RETURNING` cho biết trạng thái có đổi không; số mới lấy từ câu cộng đếm, không đọc lại bài.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Ít việc hơn trong lúc giữ khoá, thứ tự khoá không đổi | Đạt | `social-use-cases.spec.ts` › "tra tên và tìm bình luận gốc trước khi khoá…" |
| Số đếm đúng khi nhiều người cùng thao tác | Đạt | `post-row-lock.int.spec.ts` (Postgres thật, chạy song song): 30 người gửi → 30; 12 người thả, đổi, bỏ tim → khớp bảng `reactions`; một người lưu 5 lần cùng lúc → +1 |
| Không chen được trả lời vào luồng đang xoá | Đạt | `post-row-lock.int.spec.ts` › gửi trả lời cùng lúc xoá gốc (5 vòng): 0 trả lời dưới gốc đã xoá; test "bình luận gốc bị xoá trong lúc chuẩn bị" |
| W1 tốt hơn | Đạt một phần | Bảng dưới |

## Kết quả đo W1 (người gửi liên tục vào cùng một bài, trung vị 3 lần, tắt tracing, hai bản chạy liền nhau)
| Người gửi | Bình luận/giây trước → sau | p95 trước → sau |
|---:|---|---|
| 1 | 60 → 53 | 30 → 34 ms |
| 2 | 78 → 106 | 42 → 34 ms |
| 5 | 89 → 99 | 144 → 91 ms |
| 10 | 86 → 119 | 191 → 210 ms |
| 25 | 114 → 124 | 291 → 373 ms |

Mẫu có phiên chờ khoá: 71% → 66%. Sức ghi tăng 10–40% từ 2 người trở lên; khoá vẫn là nút thắt (còn 3 câu + COMMIT trong khoá). Bước tiếp: bỏ cộng `comment_count` khỏi đường gửi (worker cộng theo lô).

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công; core-api 2639 pass, 4 skip có sẵn.
- Test tích hợp content: 96/96 (gồm `moderation.int.spec.ts`, `pre-publication.int.spec.ts` của Trang) và `post-row-lock.int.spec.ts` 4/4.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run --config vitest.int.config.ts src/modules/content/social/application/use-cases/post-row-lock.int.spec.ts`.
2. Bộ đo: `tools/bench/comments/run.sh wsweep` (nhánh `thanh/TF99-benchmark-binh-luan`) trên bản develop rồi bản nhánh này.

## Ảnh / video
- Không đính kèm.

## Ảnh hưởng tới phần của người khác
- Khoá trong `add-comment` do Trang thêm: giữ nguyên `FOR UPDATE` và thứ tự khoá, đã báo Trang. `moderation.int.spec.ts`, `pre-publication.int.spec.ts` pass không sửa.
