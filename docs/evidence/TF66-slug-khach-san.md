# TF66: slug cho khách sạn

- Jira: SCRUM-70 · Nhánh: `thang/TF66-slug-khach-san` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-09

## Đã làm
- Thêm cột `slug` (unique, not null) cho `commerce.properties`. Id `P-h-...` vẫn là khoá chính.
- Slug gồm tên không dấu và 4 ký tự từ hash của id, nên seed lại vẫn ra đúng slug cũ.
- `GET /api/hotels/:slug` và `/:slug/reviews` nhận slug, tạm nhận cả id cũ. Response chi tiết và `CommerceFacade.listCatalog` trả `slug`.
- Cập nhật `contracts/openapi/core-api.json` bằng `pnpm contracts:build`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| URL khách sạn dùng slug | Một phần: API đạt, web và app chưa đổi | `hotels.e2e.spec.ts`, test TF66 |
| Id cũ vẫn chạy | Đạt | `hotels.e2e.spec.ts`, test TF66 |
| `contracts/openapi` cập nhật | Đạt | `contracts/openapi/core-api.json` |

## Kết quả kiểm tra
- Lint, typecheck, kiểm ranh giới module: pass.
- core-api: chỉ còn 2 test `content/social` fail, cũng fail trên `develop` ở máy này.
- Test tích hợp commerce trên Postgres thật (migration và seed thật): 48/48.
- Toàn bộ khách sạn trong `catalog.json` có slug hợp lệ, không trùng (`hotel-slug.spec.ts`).

## Cách kiểm lại
1. `pnpm stack:be`, chạy migrate rồi `pnpm db:seed`.
2. Gọi `GET /api/hotels/<slug>` và `GET /api/hotels/P-h-dn-01`.

## Ảnh hưởng tới phần của người khác
- Có: TF67 (Duy) dùng `slug` từ `listCatalog`. Web (Thành), mobile (Trang) đổi route sau khi merge.
- DB đã có dữ liệu: migration điền tạm slug bằng `lower(id)`, phải chạy seed để có slug thật.
- Vẫn nhận id cũ nên chưa chặn được việc dò id; cần task tắt id cũ khi app bản cũ không còn dùng.
