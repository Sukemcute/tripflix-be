# TF99 — Benchmark bình luận, lần đo đầu (B0)

- Jira: TF99 · Nhánh: `thanh/TF99-benchmark-binh-luan` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-16
- Kế hoạch: báo cáo "Bình luận chịu tải và realtime" (mục 1 · Benchmark, lộ trình B0).

## Đã làm
- **Bộ đo `tools/bench/comments/`** (chỉ thư viện có sẵn của Node, k6 chạy qua Docker image `grafana/k6:2.4.0`, không thêm dependency):
  - `setup-users.mjs`: 5 tài khoản thử qua luồng đăng ký thật, mã email đọc từ Mailpit.
  - `seed.sql`, `cleanup.sql`: 1 bài thử, 10.000 bình luận (8.000 gốc, 2.000 trả lời), thời gian có phần micro giây như dữ liệu thật.
  - `k6/read.js` (R1), `k6/write.js` (W1: load, stress, spike, soak), `explain.sql` (R2).
  - `run.sh`, `summarize.mjs`: chụp thống kê bảng trước, sau; lấy mẫu chờ khoá mỗi 100 ms; gom `out/summary.md`.
- F1, F2 (đo phía web) và RT1 (realtime) làm ở bước sau.

## Số đo "trước" (máy local, k6 + core-api + Postgres cùng một laptop)
### R1 · 50 người cùng đọc (mỗi trang 30 s)
| Trang | Số request | p50 | p95 | p99 | Ngưỡng p95 < 150 ms |
|---|---:|---:|---:|---:|---|
| 1 | 7.023 | 186 ms | 440 ms | 575 ms | Trượt |
| 50 | 7.249 | 191 ms | 325 ms | 557 ms | Trượt |
| 400 | 6.175 | 221 ms | 392 ms | 599 ms | Trượt |

- 0% lỗi. Phân trang đi hết 400 trang: thấy đủ 8.000/8.000, không thiếu, không lặp.
- Mỗi request đọc quét `content.comments` 2,5 lần, trong đó **1 lần quét tuần tự cả bảng** (câu đếm, xem R2).
- Không có phiên chờ khoá; tối đa 6 phiên DB chạy cùng lúc (pool content là 10), nên pool không phải nút thắt khi đọc.

### R2 · EXPLAIN (bài 10.000 bình luận)
| Câu | Cách đọc | Dòng bị lọc bỏ | Thời gian |
|---|---|---:|---:|
| Trang bình luận gốc | `idx_comments_post_created` lùi rồi lọc `parent_comment_id IS NULL` | khoảng 230 mỗi trang (trả lời lẫn vào) | < 1 ms |
| Đếm bình luận gốc (chạy ở mọi trang) | **Seq Scan cả bảng** | 2.060 | 2,3 ms |
| Đếm trả lời của 20 bình luận | `idx_comments_parent` | – | 0,6 ms |

Ngưỡng "mỗi trang đọc ≤ 21 dòng": trượt, vì index không có `parent_comment_id`, nên phải đọc và lọc bỏ các trả lời (mục 2.3).

### W1 · nhiều người cùng gửi vào một bài (mỗi mức 30 s)
| Người gửi | Số request | p50 | p95 | p99 | Ngưỡng p95 < 300 ms |
|---|---:|---:|---:|---:|---|
| 50 | 3.006 | 463 ms | 852 ms | 1.116 ms | Trượt |
| 100 | 2.992 | 962 ms | 1.594 ms | 2.010 ms | Trượt |
| 200 | 3.636 | 1.575 ms | 2.449 ms | 2.690 ms | Trượt |

- 0% lỗi. Sức ghi đứng ở khoảng **100 bình luận/giây** dù tăng từ 50 lên 200 người: thêm người chỉ làm hàng chờ dài ra.
- **93% mẫu có phiên chờ khoá**, trung bình 8 phiên cùng chờ: các lượt thêm bình luận xếp hàng chờ dòng bài (`findByIdForUpdate` khoá dòng bài suốt transaction). Đúng chỗ mục 2.4 cần sửa.

## Kết luận cho bước sau
- **S1 (2.1, 2.2):** bỏ câu đếm chạy ở mọi trang hoặc chỉ đếm ở trang đầu, bỏ được 1 lần quét tuần tự mỗi request đọc.
- **S2 (2.3):** index bộ phận `(post_id, created_at DESC, id DESC) WHERE parent_comment_id IS NULL AND status = 'visible' AND deleted_at IS NULL` để mỗi trang đọc đúng 21 dòng.
- **S2 (2.4):** rút ngắn thời gian giữ khoá dòng bài khi thêm bình luận (cộng `comment_count` bằng một câu `UPDATE` ở cuối thay vì khoá từ đầu), đo lại W1.
- p95 khi đọc cao hơn nhiều so với thời gian truy vấn (dưới 3 ms): phần lớn nằm ở core-api (Node xử lý tuần tự 50 người) và việc k6 chạy chung máy. Sẽ thấy rõ hơn sau S1, S2 và khi đo từ máy khác.

## Kết quả kiểm tra
- Chạy thật trên máy local: `run.sh` (seed, explain), `run.sh read`, `run.sh load`. Số liệu ở trên.
- `k6 inspect` cả 4 chế độ của `write.js` và `read.js`: hợp lệ.
- Không đổi code ứng dụng nên không ảnh hưởng lint, typecheck, test của core-api.

## Cách kiểm lại
1. Làm theo `tools/bench/comments/README.md`: tạo tài khoản thử (một lần), `bash tools/bench/comments/run.sh`.
2. `cat tools/bench/comments/out/summary.md`.
3. Xong thì `bash tools/bench/comments/run.sh cleanup`.

## Ảnh / video
- Không đính kèm (theo yêu cầu).

## Ảnh hưởng tới phần của người khác
- Không sửa code của ai. DB local có thêm 5 tài khoản `bench-*@tripflix.local` (giữ lại để đo lần sau) và dữ liệu thử của một bài (xoá bằng `cleanup`).
