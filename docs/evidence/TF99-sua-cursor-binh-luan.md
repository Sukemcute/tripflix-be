# TF99 — Cursor phân trang không bỏ sót dòng cùng mili giây

- Jira: TF99 · Nhánh: `thanh/TF99-sua-cursor-binh-luan` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Lỗi phát hiện khi benchmark (`docs/evidence/TF99-benchmark-binh-luan.md` trên nhánh benchmark): sau khi nhiều người gửi cùng lúc, đi hết các trang bình luận của bài 11.506 bình luận gốc chỉ thấy 11.501.
- Nguyên nhân: cursor lưu thời gian bằng `toISOString()` (mili giây), Postgres lưu micro giây. Dòng cuối trang `.048123` cho cursor `.048000`; điều kiện `created_at < .048000 OR (= .048000 AND id < …)` loại mọi dòng khác cùng mili giây mà nhỏ hơn `.048123`. Cursor đồng bộ theo `updatedAt` (tăng dần) còn tệ hơn: không tiến lên được, lặp trang.
- Sửa: helper `infra/keyset-cursor.ts` lấy lại thời gian đủ micro giây của chính dòng cursor trong DB (câu con chạy một lần, tra theo khoá chính). Dòng không còn hoặc thời gian đã đổi (bài vừa sửa giữa hai trang) thì dùng mốc trong cursor như trước, không nhảy cóc. Định dạng cursor không đổi nên cursor client đang giữ vẫn dùng được; API không đổi.
- Áp dụng cho 6 danh sách của `content/social`: bình luận, bài công khai, bài của một người, bài trong trang admin, bài đã lưu, đồng bộ bài theo `updatedAt` (`findPostsForSync`).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Đi hết trang không thiếu, không lặp dòng cùng mili giây | Đạt | `keyset-cursor.int.spec.ts`: bình luận, 3 danh sách bài, bài đã lưu, đồng bộ `updatedAt` (4 ca fail trước khi sửa, pass sau khi sửa) |
| Dòng cursor bị sửa giữa hai trang không làm nhảy cóc | Đạt | `keyset-cursor.int.spec.ts` › "dòng của cursor đã đổi thời gian" |
| Kiểm trên app thật | Đạt | core-api build từ nhánh này, `run.sh paging` (25 người gửi dồn dập rồi đi hết trang): 656 trang, total 13.106, thấy 13.106, thiếu 0, lặp 0; có 24 bình luận chung mili giây (trước khi sửa: thiếu 5/11.506 với 14 bình luận chung mili giây) |
| Không làm truy vấn chậm hơn | Đạt | EXPLAIN trang giữa bài 10.000 bình luận: câu con là InitPlan tra khoá chính (0,02 ms), tổng 2,51 ms so với 2,47 ms trước khi sửa |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công, lint 0 lỗi.
- Integration `content/social`: 6 file, 19 test pass. Unit `content`: 30 file, 518 test pass.

## Ghi chú
- Điều kiện cursor dạng `OR` không dùng được index để nhảy thẳng tới vị trí cursor (trước và sau khi sửa như nhau): trang sâu phải quét lùi qua các dòng phía trước. Để vào bước S2 (index bộ phận, so theo cặp `(created_at, id)`).
- `content.facade.ts` dùng cursor đồng bộ qua `findPostsForSync` nên được sửa theo; không đổi code của facade.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run --config vitest.int.config.ts src/modules/content/social/infra/keyset-cursor.int.spec.ts`.
2. Trên nhánh benchmark (`thanh/TF99-benchmark-binh-luan`): build và chạy core-api từ nhánh này, `bash tools/bench/comments/run.sh paging`, xem dòng "phân trang" trong log: thiếu 0, lặp 0.

## Ảnh / video
- Không đính kèm.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa repository của `content/social`.
