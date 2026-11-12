# TF10 — Sửa UX reel mobile: API tìm người dùng (phần BE)

- Notion: — · Nhánh: `bao/TF10-mobile-reel-ux` · Người làm: Bảo (dùng AI: có) · Ngày: 2026-11-12

## Đã làm
- Thêm `GET /api/v1/users/search?q=&page=` (công khai, không cần đăng nhập) cho khung tìm kiếm của app mobile, tab "Người dùng". Trả `{ items: [{ id, displayName }], page, hasMore }`, 20 người mỗi trang.
- Chỉ khớp **tên hiển thị**, không khớp email (để ô tìm kiếm công khai không thành chỗ dò email); chỉ tài khoản `status = 'active'`; bỏ dấu tiếng Việt cả hai vế: SQL `translate(lower(display_name), …)` và `foldVietnamese()` cho từ khoá, nên "bao" khớp "Bảo".
- `q` 1–50 ký tự (sau trim), `page` 1–1000, validate bằng zod, sai thì 400 với câu tiếng Việt.
- Thêm `searchPublic` vào `AccessStore.users` (port, Drizzle, memory), use case `UserSearchUseCases`, controller `UserSearchController`, DTO `UserSearchResponseDto`.
- Video của người được chọn dùng API có sẵn `GET /api/v1/posts?author_id=<id>&post_type=video`, không cần thêm gì.
- `shortcut:` quét tuần tự bảng users (đủ cho pilot vài nghìn tài khoản); lớn hơn thì thêm cột tên đã bỏ dấu + index trigram.
- Theo yêu cầu của Bảo trong phiên: **bỏ** phần phương tiện/lưu trú có cấu trúc trong lộ trình (`segments`, `stays`), không đụng `content/social`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Khớp không dấu ("bao" ↔ "Bảo") | ✅ | `user-search.e2e.spec.ts`, `drizzle-access.store.int.spec.ts` (Postgres thật), curl `q=thanh` → "Thành viên mẫu" |
| Không khớp email | ✅ | e2e "không khớp email"; curl `q=admin` → rỗng dù có `superadmin@…` |
| Ẩn tài khoản bị khoá | ✅ | e2e "ẩn tài khoản bị khoá", int test |
| Phân trang 20/trang + hasMore | ✅ | e2e "20 người mỗi trang" |
| `q` 1–50 ký tự | ✅ | e2e 400; curl `q=%20%20`, thiếu `q`, 51 ký tự → 400 |
| Chạy qua `http://localhost:8080` | ✅ | curl bên dưới |
| Contracts sinh lại | ✅ | commit `build(contracts)` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công; core-api 89 file test pass (1 skip có sẵn), **2183 test pass**, 1 skip; notification-service 73 pass; video-worker 49 pass; outbox 9 pass. Lint 0 lỗi, không thêm cảnh báo mới.
- `pnpm exec vitest run --config vitest.int.config.ts src/modules/access/auth/infra/drizzle-access.store.int.spec.ts`: 19/19 pass (Postgres thật qua testcontainers).
- curl qua traefik:
  ```
  GET /api/v1/users/search?q=thanh      → {"items":[{"id":"9b86…","displayName":"Thành viên mẫu"}],"page":1,"hasMore":false}
  GET /api/v1/users/search?q=QUAN%20TRI → {"items":[{"id":"14b0…","displayName":"Quản trị viên"}],…}
  GET /api/v1/users/search?q=admin      → {"items":[],"page":1,"hasMore":false}
  GET /api/v1/users/search?q=%20%20     → 400 {"message":"Dữ liệu gửi lên không hợp lệ","errors":[{"field":"q","message":"Cần từ khoá"}]}
  ```

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `cd apps/core-api && pnpm exec vitest run src/modules/access/user-search.e2e.spec.ts`
3. Stack local đang chạy: `curl "http://localhost:8080/api/v1/users/search?q=bao"`
4. FE: `pnpm gen:api` để lấy `UserSearchController_search` / `UserSearchResponseDto`.

## Ảnh / video
- Không đổi giao diện ở BE.

## Ảnh hưởng tới phần của người khác
- ⚠️ Có: module `access` (chủ **Dũng**, backup Duy). Chỉ **thêm**: method `searchPublic` trong `UserRepository` (`auth/application/ports.ts`, `drizzle-access.store.ts`, `memory-access.store.ts`), controller/use case mới trong `account/`, đăng ký trong `access.module.ts`, thêm một ca trong `drizzle-access.store.int.spec.ts`. Không đổi chữ ký hay hành vi có sẵn (`search` của admin giữ nguyên). Cần Dũng duyệt PR.
- `content/social` (Thành): **không đụng** — phần `segments`/`stays` đã bỏ theo yêu cầu.
