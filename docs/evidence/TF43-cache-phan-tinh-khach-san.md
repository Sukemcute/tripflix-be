# TF43 — Cache phần tĩnh của trang khách sạn

- Notion: TF43 · Nhánh: `thang/TF43-cache-doc-pgbouncer` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-25

## Đã làm
- `HotelDetailUseCases` giữ phần tĩnh của khách sạn (thông tin, loại phòng, gói giá) 5 phút theo slug hoặc id (`TtlCache`, gộp các lời gọi trùng).
- Lý do: cache trong `HotelsController` có ngày nhận/trả phòng trong khoá, nên mỗi tổ hợp ngày lại chạy 2 câu SQL đọc khách sạn và loại phòng. Phần tĩnh chỉ đổi khi seed hoặc nhập dữ liệu. Giá và số phòng vẫn tính từ lịch trong bộ nhớ ở mỗi lần gọi, nên không bị cũ thêm.
- Không có khách sạn thì vẫn ném `not_found` và không giữ lỗi: khách sạn vừa thêm hiện ngay ở lần gọi sau.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Trang khách sạn với ngày khác nhau không đọc lại database phần tĩnh | Có | `hotel-detail.use-cases.spec.ts`: hai kỳ ở khác nhau chỉ đọc khách sạn và loại phòng một lần |
| Giá, số phòng vẫn mới | Có | Test "giá lịch thay đổi thì lần gọi sau thấy giá mới" |
| Không bán quá, không lỗi khi có tải | Có | Đo tải bên dưới: 0 lỗi, 0 ô bán quá |

## Kết quả kiểm tra
- `vitest run src/modules/commerce`: 38 file, 1.468 test qua (gồm 4 test mới).
- `pnpm turbo run lint typecheck --filter=@tripflix/core-api`: qua.
- Đo tải local (1 bản API, 1.500 người dùng ảo trong 150 giây, ngày nhận phòng ngẫu nhiên trong 30 ngày, tỉ lệ 70% xem khách sạn):

| | Trước | Sau |
|---|---|---|
| Tổng request | 15.961 | 15.880 |
| Transaction tới database commerce | 40.071 | 26.910 (−33%) |
| CPU Postgres trung bình | 45,5% | 37,1% |
| Xem khách sạn p50 / p95 / p99 | 11 / 23 / 39 ms | 7 / 21 / 23 ms |
| Lỗi, ô bán quá | 0, 0 | 0, 0 |

## Cách kiểm lại
1. `cd apps/core-api && npx vitest run src/modules/commerce/inventory/application/hotel-detail.use-cases.spec.ts`
2. Đo tải: chạy `load.mjs` (bài đo 16/11) với `SCENARIO=load STAGES="1500:150"` trên bản trước và sau, so `xact_commit` của `pg_stat_database` trước và sau mỗi lượt.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `commerce/inventory`.
