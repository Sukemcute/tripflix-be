# TF06 — Kho sản phẩm của commerce: database riêng, seed, lịch trống 180 ngày

- Notion: <dán link task TF06> · Nhánh: `thang/TF06-kho-san-pham-commerce` · Người làm: Thắng Nguyễn Lê Phúc (dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- Bảng trong database `commerce` (Drizzle, migration `20261104084533_init_catalog`): `properties`, `room_types`, `room_inventory (total, held, sold)`, `room_rates`, `flights` (mỗi dòng một hạng ghế, `flight_key` gom các hạng của một chuyến), `flight_inventory`. CHECK `held + sold <= total` là chốt chặn cuối chống bán quá.
- Seed danh mục giả lập (`db/seed/catalog.json`: 220 khách sạn, 642 loại phòng, 313 hạng ghế, xuất từ bộ dữ liệu được cấp). Chạy lại được: cập nhật thông tin sản phẩm, không động vào lịch trống, số đã giữ, đã bán. Không có vé vui chơi và combo, đúng phạm vi task.
- Job mở lịch trống (`inventory/jobs/open-calendar.job.ts`): 6 giờ/lần và khi seed, giữ đủ 180 ngày tới, chỉ chèn ngày còn thiếu. Chỉ chạy khi `APP_ROLE` là `worker` hoặc `all`.
- `CommerceFacade` export qua `commerce/index.ts` cho module khác gọi trong tiến trình:
  - `listCatalog({ type, provinceSlug, cursor, limit, days })`: khách sạn / chuyến bay kèm tỉnh thành, ảnh, giá thấp nhất, số ngày còn bán, các loại phòng / hạng ghế; phân trang theo con trỏ.
  - `checkAvailability({ productIds, checkIn, checkOut, rooms, adults })`: còn chỗ và giá cho tối đa 100 mã trong một lần gọi (2–3 câu query). Nhận mã khách sạn (trả loại phòng rẻ nhất còn đủ chỗ) hoặc mã loại phòng, mã chuyến hoặc mã hạng ghế. Áp đủ luật bán: ngừng bán, CTA, CTD, số đêm tối thiểu/tối đa.
- Luật bán và cách tính giá nằm ở `inventory/domain/`, hàm thuần, dùng lại được cho giữ chỗ (TF30).

## Chưa làm trong PR này (vẫn thuộc TF06)
- Màn "Lịch trống & giá" cho superadmin (sửa giá, số phòng; không cho giảm `total` dưới `held + sold`) kèm `audit_log`.
- Sự kiện outbox `commerce.ari.updated`: chờ `libs/outbox` (Dũng, chưa làm).
- `@Transactional('commerce')`: repo chưa có `libs/db-tx`; transaction hiện mở trong store giống module `access`.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Database riêng `commerce` với các bảng kho sản phẩm | Đạt (phần kho; `orders`, `payments`… thuộc TF29/TF30) | migration `commerce/db/migrations/20261104084533_init_catalog`; `node dist/cli/migrate.js` → `commerce: đã migrate` |
| Seed dữ liệu giả lập, chạy lại được để reset demo | Đạt | `pnpm db:seed` lần 1: mở 115.560 ngày phòng, 56.340 ngày bay; lần 2: 0, 0 |
| Job 6 giờ/lần mở lịch cho đủ 180 ngày, không động vào ngày đã có | Đạt | test `mở đủ cửa sổ… chạy lại không thêm, không đè ngày đã bán` |
| Không cho bán quá số phòng | Đạt | CHECK `ck_room_inventory_not_oversold` chặn `sold = total + 1` trên Postgres thật |
| Module khác chỉ đọc qua `commerce.checkAvailability` | Đạt | `CommerceFacade` trong `index.ts`; `check-boundaries`: không vi phạm |
| Màn Lịch trống & giá, `audit_log`, outbox `commerce.ari.updated` | Chưa | Làm ở PR sau của TF06 |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: lint 0 lỗi, typecheck pass, **33/33 test pass** (6 file; commerce thêm 15 test ở `sales-rules.spec.ts`, `catalog.use-cases.spec.ts`).
- `node tools/check-boundaries.mjs`: không có vi phạm.
- Chạy thật trên Postgres local (`deploy/compose.yaml`):
  - `listCatalog({ limit: 200 })`: 200 khách sạn trong 166 ms; đi hết theo con trỏ được đủ 220, không trùng.
  - `checkAvailability` 100 mã (99 khách sạn + 1 mã không có): 35 ms, 97 còn chỗ, mã lạ trả `isFound: false`.

## Cách kiểm lại
1. `pnpm stack:infra`
2. `pnpm --filter @tripflix/core-api build`
3. Trong `apps/core-api` (đặt biến môi trường theo `.env.example`): `pnpm db:migrate` rồi `pnpm db:seed`
4. `pnpm --filter @tripflix/core-api test`

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `apps/core-api/src/cli/seed.ts` (seed tài khoản của Dũng). Chỉ **thêm** đoạn seed commerce ở cuối và 3 dòng import, không sửa phần của access. Cần báo Dũng.
- Duy (discovery): chữ ký `listCatalog` / `checkAvailability` viết theo tin nhắn của Duy, chưa đối chiếu với `docs/proposals/ota-listing-contract.md` (file chưa có trên `develop`). Cần Duy duyệt.
