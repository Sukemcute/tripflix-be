# TF43 — Giữ chỗ bớt lượt hỏi database

- Notion: TF43 · Nhánh: `thang/TF43-cache-doc-pgbouncer` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-25

## Đã làm
- Đo trước khi sửa:
  - Đếm câu SQL từng bước bằng log Postgres (`log_statement=all`, đánh dấu ranh giới từng bước). Một lượt đặt 2 đêm: giữ chỗ 17 câu, nhập khách 6, trả tiền 27, tất cả chạy nối tiếp trên một kết nối.
  - CPU profile (`node --cpu-prof`) ở 150 thao tác/giây: API bận khoảng 47%. Không hàm nào nổi trội; phần dựng câu, gửi câu và đọc kết quả SQL (drizzle, pg, ghi socket, giải mã chuỗi) chiếm khoảng 1/3 thời gian bận. Vậy bớt số câu nối tiếp là hướng đúng.
- Sửa ở luồng giữ chỗ:
  - Gộp `set_config('lock_timeout')` và `pg_advisory_xact_lock` thành một câu. Đặt `set_config` trong bảng con ở `FROM` để nó chạy trước khi bắt đầu chờ khoá.
  - `insertOrder` trả cả bản ghi (`RETURNING`), nên trang giỏ vừa tạo không phải đọc lại đơn.
  - Giữ chỗ từ 17 còn 15 câu.
- Không đổi API, không đổi schema.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Giữ chỗ ít câu SQL hơn | Có | Log Postgres: 17 → 15 câu |
| Giới hạn chờ khoá vẫn đúng | Có | `checkout.int.spec.ts` (gồm trường hợp LOCK_TIMEOUT) qua trên Postgres thật |
| Không bán quá, không lỗi | Có | Đo bên dưới: 0 lỗi, 0 ô bán quá ở cả 6 lượt |

## Kết quả kiểm tra
- `vitest run src/modules/commerce`: 1.468/1.468 qua.
- `vitest run --config vitest.int.config.ts src/modules/commerce`: 5 file, 65/65 qua.
- `pnpm turbo run lint typecheck test --affected`: lint và typecheck qua. Test: 3.198 qua, 2 lỗi có sẵn ở `content/social` (test bình luận 2.000 ký tự phụ thuộc locale máy), không liên quan.
- Đo tải: 1 bản API, tải mở 250 thao tác/giây trong 60 giây (tỉ lệ 70% xem khách sạn, 15% giữ rồi huỷ, 10% đặt trọn, 5% xem chuyến đi). Chạy xen kẽ trước, sau, trước, sau, mỗi bản 3 lượt, lấy trung vị:

| | Trước (3 lượt) | Sau (3 lượt) |
|---|---|---|
| CPU API trung bình | 81 / 83 / 82% | 75 / 70 / 72% |
| Giữ chỗ p50 | 52 / 46 / 44 ms | 41 / 34 / 36 ms |
| Giữ chỗ p95 | 780 / 545 / 504 ms | 804 / 90 / 84 ms |
| Trả tiền p95 | 896 / 538 / 608 ms | 1.230 / 143 / 141 ms |
| Lỗi, ô bán quá | 0, 0 | 0, 0 |

- CPU API và p50 giảm đều ở cả 3 lượt. p95 ở mức API bận khoảng 80% dao động mạnh: lượt "sau 1" vẫn cao như bản trước. Vì vậy không coi mức giảm p95 là kết quả chắc chắn.

## Cách kiểm lại
1. `npx vitest run --config vitest.int.config.ts src/modules/commerce` (cần Docker).
2. Đếm câu SQL: bật `log_statement=all`, chạy một lượt đặt (`count-sql.mjs` trong bài đo), đếm câu giữa các dấu `MARK`.
3. Đo tải: `RATES="250:60" node load.mjs` cho bản trước và sau, mỗi bản 3 lượt xen kẽ, so trung vị.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `commerce/booking`. Hai test sửa theo hợp đồng mới là test của commerce (`checkout-gate.spec.ts`, `checkout-errors.spec.ts`), không nới lỏng điều kiện kiểm.
