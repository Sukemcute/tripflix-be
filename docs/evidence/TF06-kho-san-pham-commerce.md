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

- API màn "Lịch trống & giá" (chỉ superadmin, `@Roles('superadmin')`):
  - `GET` / `PATCH /api/admin/commerce/room-types/:id/calendar`: xem, sửa giá, số phòng, ngừng bán, CTA, CTD, số đêm tối thiểu/tối đa theo khoảng ngày (tối đa 93 ngày).
  - `GET` / `PATCH /api/admin/commerce/flights/:id/calendar`: xem, sửa giá, số ghế, ngừng bán.
  - Mỗi lần sửa là một transaction `@Transactional('commerce')`: `UPDATE ... WHERE` có điều kiện cả khoảng + ghi `audit_logs`. Có ngày chưa mở bán, hoặc giảm `total` dưới `held + sold` ở ngày nào thì 409 kèm danh sách ngày và **không ngày nào bị đổi**.
- Bảng `audit_logs` (migration `20261104152234_add_audit_logs`): ai sửa, sửa gì, khoảng ngày nào.
- Store đọc kết nối qua TransactionHost của commerce (`libs/db`), nên mọi ghi trong use case có `@Transactional('commerce')` nằm chung một transaction. Mở lịch chèn phòng + giá trong một câu lệnh (CTE), không mở transaction ở infra.
- Test trên Postgres thật bằng `libs/testing` (`drizzle-commerce.store.int.spec.ts`).

## Chưa làm (vẫn thuộc TF06)
- Sự kiện outbox `commerce.ari.updated` khi sửa lịch: `libs/outbox` đã có, nhưng cần chốt payload với Duy (bên nhận) và thêm schema vào `libs/contracts` (báo Dũng).
- Giao diện màn Lịch trống & giá trong `tripflix-fe/apps/admin` (của Thành): chờ xác nhận ai làm.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Database riêng `commerce` với các bảng kho sản phẩm | Đạt (phần kho; `orders`, `payments`… thuộc TF29/TF30) | migration `commerce/db/migrations/20261104084533_init_catalog`; `node dist/cli/migrate.js` → `commerce: đã migrate` |
| Seed dữ liệu giả lập, chạy lại được để reset demo | Đạt | `pnpm db:seed` lần 1: mở 115.560 ngày phòng, 56.340 ngày bay; lần 2: 0, 0 |
| Job 6 giờ/lần mở lịch cho đủ 180 ngày, không động vào ngày đã có | Đạt | test `mở đủ cửa sổ… chạy lại không thêm, không đè ngày đã bán` |
| Không cho bán quá số phòng | Đạt | CHECK `ck_room_inventory_not_oversold` chặn `sold = total + 1` trên Postgres thật |
| Module khác chỉ đọc qua `commerce.checkAvailability` | Đạt | `CommerceFacade` trong `index.ts`; `check-boundaries`: không vi phạm |
| Màn Lịch trống & giá: sửa giá, số phòng theo ngày hoặc khoảng ngày; không cho giảm total dưới held + sold | Đạt (API) | `admin-calendar.e2e.spec.ts`; int test `giảm số phòng dưới held + sold ở một ngày: rollback cả khoảng` |
| Mỗi lần sửa ghi `audit_log` | Đạt | e2e `ghi audit_logs`; int test kiểm dòng trong `commerce.audit_logs` |
| Sửa giá thì trang chi tiết hiện giá mới | Đạt | int test `checkAvailability thấy giá mới` (đọc thẳng lịch, không cache) |
| Sửa giá thì tìm kiếm hiện giá mới (outbox `commerce.ari.updated`) | Chưa | Chờ chốt payload với Duy |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: lint 0 lỗi, typecheck pass, **38/38 test pass** (commerce: 20 test ở `sales-rules.spec.ts`, `catalog.use-cases.spec.ts`, `admin-calendar.e2e.spec.ts`).
- `pnpm --filter @tripflix/core-api test:int` (Postgres thật, Testcontainers): **9/9 pass**, trong đó commerce 5 test: mở lịch đủ phòng + giá, phân trang, CHECK chống bán quá, sửa giá ghi audit, rollback khi vi phạm.
- `pnpm contracts:build`: `contracts/openapi/core-api.json` chỉ thêm 4 endpoint admin, không đổi endpoint cũ.
- `node tools/check-boundaries.mjs`: không có vi phạm.
- Chạy thật trên Postgres local (`deploy/compose.yaml`):
  - `listCatalog({ limit: 200 })`: 200 khách sạn trong 166 ms; đi hết theo con trỏ được đủ 220, không trùng.
  - `checkAvailability` 100 mã (99 khách sạn + 1 mã không có): 35 ms, 97 còn chỗ, mã lạ trả `isFound: false`.

## Cách kiểm lại
1. `pnpm stack:infra`
2. `pnpm --filter @tripflix/core-api build`
3. Trong `apps/core-api` (đặt biến môi trường theo `.env.example`): `pnpm db:migrate` rồi `pnpm db:seed`
4. `pnpm --filter @tripflix/core-api test` và `pnpm --filter @tripflix/core-api test:int` (cần Docker)

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `apps/core-api/src/cli/seed.ts` (seed tài khoản của Dũng). Chỉ **thêm** đoạn seed commerce ở cuối và 3 dòng import, không sửa phần của access. Cần báo Dũng.
- Dùng `@Transactional`, `libs/testing` của Dũng đúng như README, không sửa `libs/`.
- Duy (discovery): chữ ký `listCatalog` / `checkAvailability` viết theo tin nhắn của Duy, chưa đối chiếu với `docs/proposals/ota-listing-contract.md` (file chưa có trên `develop`). Cần Duy duyệt.
