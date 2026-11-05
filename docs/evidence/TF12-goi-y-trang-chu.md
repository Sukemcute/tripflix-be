# TF12 — Khối "Gợi ý dành cho bạn" trên trang chủ web (phần BE)

- Notion: https://app.notion.com/40dcb9b9e5c2812eb772e44063a4c66c · Jira: SCRUM-16 · Nhánh: `duy/TF12-goi-y-trang-chu` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-05

## Đã làm

- `GET /api/recommendations/home?recentPlaceIds=&limit=` (công khai, không cần đăng nhập, server không lưu gì về người dùng). Mỗi gợi ý kèm `reason { code, text }` tiếng Việt.
- Lý do tuần 1, chỉ ghi điều đúng sự thật tính được từ danh mục commerce:
  - `recent_place` — "Vì bạn vừa tìm Đà Lạt": web tự nhớ các `refId` địa điểm người dùng vừa chọn ở `/api/suggest` trong trình duyệt. Tối đa 3 nơi, mỗi nơi 2 khách sạn (tỉnh gồm điểm đến con), nhiều sao rồi rẻ trước.
  - `good_deal` — "Rẻ hơn 37% so với giá trung bình khách sạn 5 sao": rẻ hơn trung vị cùng hạng sao ≥ 10%. Mỗi tỉnh một và mỗi chuỗi (`brand`) một để đa dạng; `brand` null là khách sạn độc lập, không giới hạn.
- Danh mục lấy qua `CommerceFacade.listCatalog({ type: 'hotel', days: 30 })`, đọc hết theo con trỏ, cache trong bộ nhớ 10 phút. Không thêm bảng, không nghe sự kiện.
- Chưa có lý do "xu hướng": chưa có lượt xem, lượt đặt. Thêm khi analytics có dữ liệu (TF28).
- Sinh lại `contracts/openapi/core-api.json`; cập nhật `modules/discovery/README.md` (mục 5).

## Đối chiếu "Xong khi"

| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng |
|---|---|---|
| Trang chủ web có khối gợi ý kèm lý do | Một phần: API có, giao diện web chưa | API trả gợi ý kèm lý do (bảng kiểm tay bên dưới). Khối giao diện trong `apps/web` thuộc Thành, làm sau khi chạy `pnpm gen:api` |

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck --filter=@tripflix/core-api`: 11/11 task thành công, lint 0 lỗi (42 cảnh báo có sẵn, không có ở discovery).
- `pnpm vitest run` trong `apps/core-api`: 24/24 file, 192/192 test pass (34s). Test mới: `home-picks.spec.ts` (5), `home-recommendations.use-cases.spec.ts` (1).
- Lần chạy trước song song với turbo và server: 17 test e2e của `access/staff` và `commerce/admin-calendar` bị timeout. Chạy lại khi máy rảnh thì pass, không liên quan TF12.

Kiểm tay trên local (seed 220 khách sạn):

| Gọi | Kết quả |
|---|---|
| `/api/recommendations/home` | 200, 8 gợi ý `good_deal`, 8 tỉnh khác nhau, không lặp chuỗi (Mường Thanh, Melia, Vinpearl, Sheraton, FLC…); lần đầu ~150ms (đọc danh mục), sau đó ~20ms |
| `?recentPlaceIds=da-lat,phu-quoc&limit=6` | 2 khách sạn Đà Lạt, 2 Phú Quốc ("Vì bạn vừa tìm …"), rồi 2 `good_deal` |
| `?recentPlaceIds=lam-dong` | Khách sạn ở Đà Lạt với lý do "Vì bạn vừa tìm Lâm Đồng" (tỉnh gồm điểm đến con) |
| `?recentPlaceIds=atlantis` | 200, bỏ qua nơi lạ, chỉ có `good_deal` |
| `?limit=99` | 400 `{ message: 'Tham số không hợp lệ', errors: [{ field: 'limit', … }] }` |

## Cách kiểm lại

1. `pnpm install`, `pnpm stack:up` (hoặc chỉ Postgres), seed commerce.
2. `pnpm --filter @tripflix/core-api build` rồi chạy `node dist/main.js` trong `apps/core-api` (`APP_ROLE=all`).
3. Gọi các URL trong bảng trên.

## Ảnh / video

- Chưa có: task này chưa đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không sửa code của người khác. Chỉ gọi `CommerceFacade.listCatalog` (đã có từ TF06).
- Dữ liệu seed commerce (Thắng): khách sạn độc lập đang ghi `brand: "Độc lập"` (129 khách sạn) thay vì `null`, nên khối gợi ý chỉ lấy tối đa 1 khách sạn độc lập. Một số khách sạn Vinpearl có `brand: null`. Đề nghị Thắng chuẩn hoá seed; discovery không ghi cứng giá trị nào.
- Nhánh này tạo từ `duy/TF11-ota-suggest` (PR #23) vì dùng `places.ts`, `stays.ts`; nên merge sau #23.
