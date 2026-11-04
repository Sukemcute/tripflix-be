# Quyết định: `commerce` dùng chung database `core`

**Ngày:** 2026-11-04 · **Trạng thái:** Đã duyệt · **Căn cứ:** sơ đồ kiến trúc v4.6, docs/11 v1.1 §3.3 · **Người đọc:** cả team BE, Tech Lead

## Tóm tắt

Bỏ database Postgres `commerce` riêng. `commerce` là **một schema trong database `core`**, giống `access`, `content`, `discovery`, `analytics`. Hệ thống chỉ còn 2 database: `core` (5 schema) và `notification`.

Ranh giới module **không đổi**: `commerce` vẫn có schema riêng, user Postgres riêng (`tf_commerce`), pool riêng và transaction riêng (`@Transactional('commerce')`). Thứ duy nhất đổi là URL kết nối.

## Lý do

- Tồn kho, đơn hàng và thanh toán đều là dữ liệu của chính nền tảng. Không có hệ thống bán hàng bên ngoài, dữ liệu là giả lập và seed lại được.
- Đơn hàng gắn với `user_id` và bài đăng nguồn. Tách database riêng chỉ làm khó việc tra cứu ở trang quản trị và thống kê, mà không đem lại lợi ích gì ở quy mô pilot.
- Ít một database thì ít một thứ phải tạo, backup và cấu hình trong compose và CI.

## Cái gì giữ nguyên

| Quy tắc | Vẫn đúng vì |
|---|---|
| Không query chéo schema | User `tf_commerce` chỉ có quyền trên schema `commerce`; các user khác không có quyền trên schema này |
| Không transaction chéo module | Mỗi module một kết nối, một `connectionName` trong `libs/db` |
| Module khác chỉ gọi qua `CommerceFacade` (`index.ts`) | Luật facade ở `RULES.md` §10 và docs/11, không phụ thuộc vào số database |
| Không đặt khoá ngoại chéo module, chỉ lưu ID | Để sau này vẫn tách được nếu cần |
| Checkout: giữ chỗ cho mọi mục và tạo đơn trong **một** transaction | Chỉ đụng các bảng của `commerce` |

Code đang dùng `pgSchema('commerce')` (TF06) **không phải sửa**.

## Cái gì phải đổi

| # | Chỗ | Hiện tại | Đổi thành | Chủ |
|---|---|---|---|---|
| 1 | `tripflix-be/deploy/postgres/init/01-databases.sql` | `CREATE DATABASE commerce;` | Bỏ dòng này | Dũng (Duy backup) |
| 2 | `tripflix-be/deploy/postgres/init/02-roles-schemas.sql` | `tf_commerce` được kết nối DB `commerce`, schema tạo sau `\connect commerce` | Cấp `CONNECT`/`CREATE` trên `core` cho `tf_commerce`; tạo `schema commerce` trong khối `\connect core`; `ALTER ROLE tf_commerce IN DATABASE core SET search_path = commerce, public` | Dũng (Duy backup) |
| 3 | `apps/core-api/.env.example`, `deploy/compose.yaml` | `DATABASE_URL_COMMERCE=…/commerce` | `DATABASE_URL_COMMERCE=postgres://tf_commerce:tf_commerce_dev@<host>:5432/core` | Dũng (Duy backup) |
| 4 | `libs/db/src/index.ts` (chú thích dòng 4) | "module `commerce` trên database riêng" | "5 module trên database `core`". Có thể gộp `commerce` vào `CORE_MODULES` | Dũng (Duy backup) |
| 4b | `libs/testing/src/postgres.ts` (dòng 16, 23) | `commerce` → database `commerce` | `commerce` → `core`; `buildAdminUrl` bỏ `'commerce'` | Dũng (Duy backup) |
| 4c | `libs/testing/src/fixtures.int.spec.ts` (dòng 30, 46) | Kiểm có đủ 3 database; kiểm `tf_access` bị chặn khi kết nối DB `commerce` | Kiểm có 2 database; đổi thành kiểm `tf_access` bị chặn khi đọc schema `commerce` (và `tf_commerce` bị chặn ở schema `access`). **Test này sẽ fail nếu chỉ sửa mục 1–3** | Dũng (Duy backup) |
| 4d | `libs/db/README.md` (dòng 15) | Bảng kết nối: `commerce` → DB `commerce` | `commerce` → DB `core` | Dũng (Duy backup) |
| 5 | `tripflix-be/README.md` (dòng 64, 72), `modules/access/README.md` (dòng 75) | Liệt kê DB `commerce`, lệnh `GRANT … DATABASE commerce` | `core` có 5 schema; bỏ lệnh grant cho DB `commerce` | Dũng / Tech Lead |
| 6 | `modules/commerce/README.md` (dòng 4, 13) | "Database riêng `commerce`" | "Database `core`, schema `commerce`" | Thắng |
| 7 | `docs/architecture/11-…md` trong 3 repo | Ghi phần database của v1.1 là "đề xuất, chờ duyệt" | **Đã sửa** ở nhánh `duy/TF57-commerce-schema-trong-core` (3 repo) | Duy (QC kiến trúc) |
| 8 | `docs/architecture/10-…md` (tóm tắt, §3.11, §4, sơ đồ mermaid) | "2 database: `core` và `commerce`", "database riêng" | **Đã sửa** ở cùng nhánh, có dòng "Cập nhật 04/11" ở đầu | Duy (QC kiến trúc) |
| 9 | Sơ đồ `06-kien-truc-tong-quan.drawio`, `ARCHITECTURE.md` trong 3 repo | v4.5 (2 Postgres) | `.drawio` **đã thay** bằng v4.6 ở cùng nhánh. **Còn:** xuất lại `06-kien-truc-tong-quan.png` từ `.drawio` | Duy / Tech Lead |
| 10 | Jira TF04, TF06, TF29, TF30, TF59 | Mô tả "database riêng `commerce`" | "schema `commerce` trong `core`" | Trang |
| 11 | PRD v3 §7 | "phân hệ Giao dịch dùng cơ sở dữ liệu riêng" (tự mâu thuẫn với câu "một cơ sở dữ liệu" ngay trước) | Bỏ vế "dùng cơ sở dữ liệu riêng". Đây là quyết định kiến trúc, không thuộc PRD | Người giữ PRD |

Mục 1 đến 5 nên đi chung **một PR** (gọi là "PR gộp DB"), để không ai kéo về nửa chừng rồi hỏng stack hoặc hỏng test.

## Các nhánh trên remote (kiểm ngày 04/11)

DB `commerce` riêng **không do nhánh nào thêm vào**: nó nằm sẵn trong `develop` và `main` từ khung repo (TF57). Vì thế mọi nhánh tạo từ `develop` đều kế thừa. Chưa nhánh nào *phụ thuộc* thật vào việc tách DB: không có code nào JOIN hay kết nối chéo giữa hai database. Chỉ có cấu hình, test hạ tầng và chú thích.

| Nhánh | Chủ | Trạng thái | Liên quan DB `commerce` | Cần làm |
|---|---|---|---|---|
| `develop`, `main` | Tech Lead | — | Nguồn gốc: init SQL, `.env.example`, compose, `libs/db`, `libs/testing` | Nhận PR gộp DB |
| `thang/TF06-kho-san-pham-commerce` | Thắng | Mở, +3 commit | **Dùng nhiều nhất**: migration `init_catalog`, seed, `CommerceFacade`, đọc `DATABASE_URL_COMMERCE`. Chú thích `commerce.module.ts:17` ghi "Database riêng commerce" | Code giữ nguyên (đã dùng `pgSchema('commerce')`). Sửa chú thích dòng 17 và `modules/commerce/README.md`. Rebase lên `develop` sau PR gộp DB; chạy lại migrate + seed trên `core` để lấy evidence |
| `thang/TF10-trang-chi-tiet-khach-san` | Thắng | Mở, xếp chồng trên TF06 | Như TF06 (chú thích ở `commerce.module.ts:19`); e2e `hotels.e2e.spec.ts` | Rebase theo TF06; chạy lại e2e trên `core` |
| `thanh/TF02-social-content` | Thành | Mở, chậm 56 commit so với `develop` | Chỉ có port `commerce-service.port.ts` (gọi qua facade), không đụng DB | Không cần sửa; rebase lên `develop` như bình thường |
| `phong/TF09-media-upload-api` | Phong | Mở | Không (chỉ sửa `.env.example` cho S3) | Có thể conflict nhẹ ở `.env.example` khi rebase, giữ cả hai thay đổi |
| `dung/TF051-hotfix-revert-main` | Dũng | Đã vào `main` | Không | Không |
| Các nhánh `dung/TF05*`, `phong/TF09-*`, `trang/TF57-*` khác | — | Đã merge | Không | Có thể xoá trên remote |
| `duy/TFxx-ota-suggest` (local, chưa push) | Duy | Chưa commit | Không (chỉ schema `discovery`) | Không |

### Thứ tự align đề xuất

1. **PR gộp DB** (Dũng, Duy backup) vào `develop`: các mục 1–5 ở bảng trên. Kiểm bằng `pnpm stack:reset`, rồi `pnpm turbo run lint typecheck test`, kể cả test `libs/testing` dùng Postgres thật.
2. **Báo cả team** ngay khi merge: mỗi người làm lại máy local theo mục dưới, nếu không `.env` cũ vẫn trỏ `/commerce`.
3. **Thắng rebase TF06**, sửa chú thích, chạy lại migrate + seed, cập nhật evidence ("schema `commerce` trên DB `core`"). Sau đó mới merge TF06, rồi tới TF10.
4. Nhánh khác rebase khi tới lượt merge, không cần làm gì thêm.
5. Tài liệu kiến trúc trong 3 repo (mục 7–9) đã sửa ở nhánh `duy/TF57-commerce-schema-trong-core`, chỉ còn xuất lại PNG. Trang sửa Jira (mục 10). Không chặn code.

Merge TF06 **trước** PR gộp DB cũng được, vì TF06 không đổi init SQL. Khi đó Thắng chỉ cần chạy lại migrate trên `core` sau khi PR gộp DB vào. Nhưng làm theo thứ tự trên thì evidence của TF06 đúng ngay từ đầu.

## Máy local đang có database `commerce` cũ

Script trong `deploy/postgres/init/` chỉ chạy khi volume Postgres còn trống. Dữ liệu commerce là seed nên không cần chuyển. Có hai cách:

1. **Làm lại volume** (mất dữ liệu local của mọi module): `pnpm stack:reset`, rồi migrate và seed lại.
2. **Giữ dữ liệu các module khác:** chạy bằng superuser:
   ```sql
   GRANT CONNECT, CREATE ON DATABASE core TO tf_commerce;
   \connect core
   CREATE SCHEMA IF NOT EXISTS commerce AUTHORIZATION tf_commerce;
   ALTER ROLE tf_commerce IN DATABASE core SET search_path = commerce, public;
   ```
   Sau đó sửa `DATABASE_URL_COMMERCE` trong `.env` sang `/core`, chạy `pnpm db:migrate` và `pnpm db:seed`. Database `commerce` cũ có thể để đó hoặc tự xoá.

## Về sau có tách lại được không

Có, vì vẫn giữ đủ điều kiện: schema riêng, user riêng, không khoá ngoại chéo, không JOIN chéo. Muốn tách thì tạo instance mới, chạy migration của `commerce` ở đó và đổi `DATABASE_URL_COMMERCE`. `discovery` cũng làm theo cách này (docs/11 §3.3).
