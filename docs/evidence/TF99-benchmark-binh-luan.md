# TF99 — Benchmark bình luận, lần đo đầu (B0)

- Jira: TF99 · Nhánh: `thanh/TF99-benchmark-binh-luan` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-16
- Kế hoạch: báo cáo "Bình luận chịu tải và realtime" (mục 1 · Benchmark, lộ trình B0).

## Đã làm
- **Bộ đo `tools/bench/comments/`** (chỉ thư viện có sẵn của Node, k6 chạy qua Docker image `grafana/k6:2.4.0`, không thêm dependency):
  - `setup-users.mjs`: 5 tài khoản thử qua luồng đăng ký thật, mã email đọc từ Mailpit.
  - `seed.sql`, `cleanup.sql`: 1 bài thử, 10.000 bình luận (8.000 gốc, 2.000 trả lời), thời gian có phần micro giây như dữ liệu thật.
  - `k6/read.js` (R1: giữ tốc độ hoặc sweep số người đọc), `k6/write.js` (W1: load, sweep, stress, spike, soak), `explain.sql` (R2).
  - `run.sh`, `summarize.mjs`: mỗi kịch bản chạy 3 lần, bảng lấy trung vị kèm khoảng p95; chụp thống kê bảng trước, sau; lấy mẫu chờ khoá mỗi 100 ms; chế độ `paging` bắt lỗi cursor.
- F1, F2 (đo phía web) và RT1 (realtime) làm ở bước sau.

## Điều kiện đo
- Một laptop (i7-11850H, 8 nhân): k6 (Docker), core-api (`node dist/main.js` chạy trên Windows), Postgres và Redis (Docker, WSL2), cùng lúc còn 2 Next dev server và vài app khác.
- Mỗi chặng mạng Windows → Docker mất khoảng 0,43 ms (p95 0,64 ms, đo bằng PING Redis trên kết nối giữ sẵn); VM thỉnh thoảng khựng 7–13 ms.
- **Một lần đo lệch 30–45%** so với lần khác (R1 50 người đọc: 234 request/giây ở lần đầu, 160 ở lần sau), nên mọi số dưới đây là trung vị 3 lần. Số dùng để so trước và sau khi sửa, không phải sức chịu của production.

## Kết quả "trước"
### R1 · đọc, giữ tốc độ cố định (trang 1, 50, 400 xen kẽ; mỗi bậc 20 s; trung vị 3 lần)
| Mục tiêu (request/giây) | Đạt được | p50 | p95 | p95 thấp–cao | Ngưỡng p95 < 150 ms |
|---:|---:|---:|---:|---:|---|
| 25 | 25 | 15 ms | 47 ms | 40–47 | Đạt 3/3 |
| 50 | 50 | 19 ms | 138 ms | 113–252 | Đạt 2/3 |
| 100 | 100 | 43 ms | 942 ms | 669–3.100 | Trượt |
| 150 | 139 | 1.758 ms | 2.699 ms | 2.511–6.096 | Trượt |
| 200 | 150 | 4.556 ms | 6.043 ms | 5.754–6.218 | Trượt, 0,6% lỗi (k6 hết thời gian kết nối) |

**Sức đọc giữ được p95 < 150 ms: khoảng 50 request/giây.** Trần khoảng 140–150 request/giây; vượt trần thì hàng chờ dài ra mãi.

### R1 · đường sức chứa (số người đọc không nghỉ, mỗi mức 15 s)
| Người đọc | Request/giây | p50 | p95 |
|---:|---:|---:|---:|
| 1 | 38 | 21 ms | 47 ms |
| 5 | 122 | 35 ms | 73 ms |
| 10 | 130 | 67 ms | 140 ms |
| 25 | 135 | 168 ms | 309 ms |
| 50 | 126 | 353 ms | 697 ms |

Từ 5 người, request/giây gần như đứng yên; độ trễ tăng đúng bằng số người ÷ request/giây (định luật Little): thời gian là xếp hàng, không phải truy vấn chậm.

### Vì sao đọc chậm: CPU của core-api
- Core-api chạy một luồng chính, đứng ở khoảng 1 nhân từ mức 5 người đọc; Postgres rảnh (tối đa 6–10 phiên, không chờ khoá). Mỗi request tốn khoảng 6–7 ms CPU.
- CPU profile 25 s lúc 10 người đọc (chỉ 5% thời gian rảnh), không có điểm nóng duy nhất:
  - **khoảng 35–40% gắn với số lần gọi DB:** drizzle-orm 8,8%, pg + pg-protocol + pg-pool 11%, ghi socket (`writev`) 11,4%, đọc chuỗi trả về.
  - Express, router, Nest khoảng 10%; `JSON.stringify` phản hồi 3,3%; Redis kiểm token 3,2%; kiểm JWT (`jose`) 2,3%; log pino 1,4%; GC 1,9%.
- Mỗi request đọc gọi Redis 1 lần và DB 5 chặng nối tiếp (bài, trang + đếm, lượt thích, đếm trả lời, tên tác giả); `content.comments` bị quét 7,3 lần mỗi request, trong đó 1 lần tuần tự cả bảng (câu đếm).
- **Hệ quả:** giảm số lần gọi DB mỗi request (bỏ câu đếm ở mọi trang, gộp các câu phụ) mới kéo được CPU xuống; index (S2) bớt việc cho Postgres nhưng Postgres không phải chỗ nghẽn khi đọc.

### R2 · EXPLAIN (bài 10.000 bình luận)
| Câu | Cách đọc | Dòng bị lọc bỏ | Thời gian |
|---|---|---:|---:|
| Trang bình luận gốc | `idx_comments_post_created` lùi rồi lọc `parent_comment_id IS NULL` | khoảng 230 mỗi trang | < 1 ms |
| Đếm bình luận gốc (chạy ở mọi trang) | **Seq Scan cả bảng** | 2.060 | 2,3 ms |
| Đếm trả lời của 20 bình luận | `idx_comments_parent` | – | 0,6 ms |

### W1 · nhiều người cùng gửi vào một bài (mỗi mức 15 s, trung vị 3 lần, seed lại trước mỗi lần)
| Người gửi | Bình luận/giây | p50 | p95 | Ngưỡng p95 < 300 ms |
|---:|---:|---:|---:|---|
| 1 | 50 | 16 ms | 36 ms | Đạt |
| 2 | 57 | 31 ms | 59 ms | Đạt |
| 5 | 62 | 51 ms | 214 ms | Đạt |
| 10 | 67 | 149 ms | 261 ms | Đạt 2/3 |
| 25 | 78 | 301 ms | 464 ms | Trượt |

- **Sức ghi gần như dừng tăng từ 2 người gửi**: mọi lượt thêm bình luận xếp hàng sau khoá `FOR UPDATE` trên dòng bài. 74% mẫu có phiên chờ khoá, trung bình 4,3 phiên cùng chờ.
- Một lượt giữ khoá khoảng 13–16 ms: phía DB 3–5 ms (đo thẳng trong container), còn lại là khoảng 5 chặng mạng nối tiếp và thời gian chờ Node rảnh tay; `getDisplayNames` (pool `access`) còn được gọi ngay trong lúc giữ khoá.
- Đây là giới hạn thiết kế, đổi máy chỉ nâng trần: một bài luôn bị chặn ở 1 ÷ thời gian giữ khoá (mục 2.4).

### Lỗi phân trang: cursor bỏ sót bình luận (đã tái hiện)
- Sau lượt ghi, đi hết 576 trang của bài 11.506 bình luận gốc: **thấy 11.501, thiếu 5**, không lặp.
- Nguyên nhân: cursor lưu `createdAt` bằng `toISOString()` (mili giây), Postgres lưu micro giây. Bình luận cuối trang `.048123` cho cursor `.048000`, điều kiện `created_at < .048000 OR (= .048000 AND id < …)` loại mọi bình luận khác cùng mili giây đó mà nhỏ hơn `.048123`. 14 bình luận gốc chung mili giây với bình luận khác, 5 cái rơi đúng ranh giới trang.
- Lần đo với dữ liệu seed không thấy vì thời gian seed ngẫu nhiên, gần như không trùng mili giây; bình luận gửi dồn dập thì trùng là bình thường. Tái hiện: `run.sh paging`.

## Sửa so với bản đo trước
- `summarize.mjs` cũ cộng cả nhóm `expected_response:true` vào tổng request nên "lượt quét mỗi request" bị chia đôi (ghi 2,5, đúng là 5 và nay đo được 7,3).
- Bản trước kết luận "phân trang không thiếu" chỉ đúng với dữ liệu seed; dữ liệu do app ghi thì có thiếu (mục trên).
- Bản trước dùng 50, 100, 200 người không nghỉ: thực chất là đo sức chứa. Nay R1 giữ tốc độ cố định để biết mức tải còn đạt ngưỡng.
- 17/11: `run.sh paging` dừng giữa chừng vì `read.js` ở chế độ sweep ghi tóm tắt tên `r1-sweep` còn `run.sh` tìm `r1-paging`; nay `run.sh` truyền `SUMMARY_NAME`. Chạy lại: đi hết 699 trang, total 13.966, thiếu 0, lặp 0.
- 17/11: `explain.sql` chép đúng điều kiện `readableStatus` của app (người xem thấy bình luận `held` của chính mình), thêm cursor dạng cặp `(created_at, id) < (x, y)` và trang trả lời để so trước, sau khi thêm index (S2).

## Kết luận cho bước sau
- **Sửa ngay (lỗi đúng sai):** cursor bình luận giữ đủ micro giây, ví dụ so `(created_at, id) < (SELECT created_at, id FROM comments WHERE id = :cursorId)` để thời gian lấy thẳng từ DB; có test tái hiện.
- **S1 (2.1, 2.2):** bỏ câu đếm chạy ở mọi trang (chỉ trang đầu hoặc lấy `comment_count` có sẵn), gộp các câu phụ của trang; đo lại R1 xem CPU mỗi request giảm bao nhiêu.
- **S2 (2.3):** index bộ phận cho bình luận gốc để mỗi trang đọc đúng 21 dòng.
- **S2 (2.4):** rút ngắn thời gian giữ khoá dòng bài khi thêm bình luận (tra tên tác giả trước transaction, cộng `comment_count` bằng một câu `UPDATE` cuối thay vì khoá từ đầu); đo lại W1.

## Kết quả kiểm tra
- Chạy thật trên máy local: `run.sh read`, `run.sh rsweep`, `run.sh wsweep` (mỗi kịch bản 3 lần), `run.sh explain`; CPU profile core-api qua DevTools Protocol lúc 10 người đọc.
- `run.sh paging` (17/11, sau khi sửa tên tóm tắt): chạy hết, có `r1-paging` trong `summary.md`.
- `k6 inspect` mọi chế độ của `read.js` và `write.js`: hợp lệ; `bash -n run.sh`: hợp lệ.
- Không đổi code ứng dụng nên không ảnh hưởng lint, typecheck, test của core-api.

## Cách kiểm lại
1. Làm theo `tools/bench/comments/README.md`: tạo tài khoản thử (một lần), `bash tools/bench/comments/run.sh`.
2. `cat tools/bench/comments/out/summary.md`.
3. `bash tools/bench/comments/run.sh paging` để thấy lỗi cursor.
4. Xong thì `bash tools/bench/comments/run.sh cleanup`.

## Ảnh / video
- Không đính kèm (theo yêu cầu).

## Ảnh hưởng tới phần của người khác
- Không sửa code của ai. DB local có thêm 5 tài khoản `bench-*@tripflix.local` (giữ lại để đo lần sau) và dữ liệu thử của một bài (xoá bằng `cleanup`).
