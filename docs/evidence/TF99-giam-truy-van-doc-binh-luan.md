# TF99 — Đọc bình luận bằng ít câu truy vấn hơn (S1, mục 2.2)

- Jira: TF99 · Nhánh: `thanh/TF99-giam-truy-van-doc-binh-luan` (phụ thuộc PR #208) · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Benchmark B0: đọc bình luận nghẽn ở CPU core-api (một luồng), khoảng 40% CPU dành cho các lượt gọi DB. Mỗi trang gọi 6 câu qua 5 lượt nối tiếp: bài; trang + đếm tổng; lượt thích; đếm trả lời; tên tác giả.
- `CommentRepository.findPage`: một câu lấy trang kèm số trả lời còn hiển thị và trạng thái đã thích của người xem (câu con dùng `idx_comments_parent` và index lượt thích; dưới 1 ms trên bài 10.000 bình luận).
- Tổng chỉ đếm ở trang đầu, mang trong cursor (`total` tuỳ chọn); trang sau dùng lại. Cursor cũ không có `total` thì đếm lại như trước.
- Đọc bài chạy song song với lấy trang và đếm; bài không xem được vẫn báo 404 trước khi trả dữ liệu.
- Kết quả: trang đầu 4 câu, trang sau 3 câu (từ 6); 2 lượt nối tiếp (từ 5). API, `contracts/`, FE không đổi. Luồng `focusCommentId` giữ nguyên.
- Lỗi ngầm tìm được nhờ integration test: Drizzle in cột của bảng chính không kèm tên bảng (`"id"`) trong câu con, nên `reply.parent_comment_id = "id"` trỏ nhầm vào bảng con và số trả lời luôn 0. Câu con giờ ghi đủ `schema.bảng.cột`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Số trả lời, đã thích đúng như trước | Đạt | `comment.repository.int.spec.ts` › "findPage…" (so với `countRepliesByParentIds`, theo người xem, khách, bình luận held) |
| Trang sau không đếm lại tổng; cursor cũ vẫn chạy | Đạt | `post-summary-and-flat-comments.spec.ts` › 2 ca cursor |
| Bài không xem được không lộ bình luận | Đạt | `post-summary-and-flat-comments.spec.ts` › "bài không xem được…" |
| Đọc chịu tải tốt hơn | Đạt | R1: giữ p95 < 150 ms tới 100 request/giây (3/3 lần), trước đó 25 (50 chỉ đạt 2/3) |

## Kết quả đo (máy local, trung vị 3 lần)
So với `docs/evidence/TF99-benchmark-binh-luan.md` (B0), cùng máy, cùng bộ đo, core-api build từ nhánh này.

### R1 · giữ tốc độ cố định (trang 1, 50, 400 xen kẽ)
| Mục tiêu (request/giây) | p95 trước | p95 sau | Đạt ngưỡng p95 < 150 ms (sau) |
|---:|---:|---:|---|
| 25 | 47 ms | 26 ms | 3/3 |
| 50 | 138 ms | 30 ms | 3/3 (trước 2/3) |
| 100 | 942 ms | 29 ms | 3/3 (trước 0/3) |
| 150 | 2.699 ms (chỉ đạt 139/s) | 80 ms | 2/3 |
| 200 | 6.043 ms (chỉ đạt 150/s) | 1.185 ms (đạt 198/s) | 1/3 |

### R1 · đường sức chứa (người đọc không nghỉ)
| Người đọc | Request/giây trước → sau | p95 trước → sau |
|---:|---:|---:|
| 1 | 38 → 75 | 47 → 25 ms |
| 5 | 122 → 177 | 73 → 49 ms |
| 10 | 130 → 209 | 140 → 75 ms |
| 25 | 135 → 225 | 309 → 159 ms |
| 50 | 126 → 196 | 697 → 331 ms |

- Trần sức đọc từ khoảng 130–150 lên khoảng 210–225 request/giây; một người đọc nhanh gấp đôi (p50 21 → 11 ms).
- Quét cả bảng `comments` mỗi request: 1,04 → 0,33 (chỉ trang đầu còn đếm; R1 đọc xen kẽ 3 trang).
- "Lượt quét `comments` mỗi request" tăng 7,3 → 24 vì Postgres tính mỗi lần câu con đếm trả lời chạy (21 lần, theo index) là một lượt; không phải đọc nhiều dữ liệu hơn.
- Phân trang đi hết 400 trang: 8.000/8.000, thiếu 0, lặp 0.

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công, lint 0 lỗi (số cảnh báo không tăng).
- Integration `content`: 14 file, 94 test pass.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run --config vitest.int.config.ts src/modules/content/social/infra/comment.repository.int.spec.ts`.
2. Build và chạy core-api từ nhánh này; trên nhánh benchmark: `bash tools/bench/comments/run.sh read` và `run.sh rsweep`, so với `docs/evidence/TF99-benchmark-binh-luan.md`.

## Ảnh / video
- Không đính kèm.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ `content/social`. Giữ nguyên lọc bình luận held (TF91, Trang) trong `findPage`.
