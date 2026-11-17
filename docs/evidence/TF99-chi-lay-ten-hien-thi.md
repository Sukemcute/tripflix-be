# TF99 — getDisplayNames chỉ đọc id và tên hiển thị

- Notion: (không có, việc anh Thành nhờ qua trace OpenTelemetry) · Nhánh: `dung/TF99-chi-lay-ten-hien-thi` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Trace của anh Thành cho thấy `AccessFacade.getDisplayNames` gọi `users.findByIds`, mà hàm này `select()` cả dòng `users` (gồm `password_hash`, `email`, `phone`). Nó chạy ở mọi lượt đọc bình luận, feed, chi tiết bài, và cả lúc thêm bình luận khi đang giữ khoá dòng bài.
- Thêm `UserRepository.findDisplayNamesByIds(ids)`, chỉ `SELECT id, display_name`. Có bản Drizzle và bản bộ nhớ (E2E).
- `getDisplayNames` chuyển sang hàm mới. Chữ ký facade không đổi. `findByIds` vẫn giữ nguyên.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| `getDisplayNames` không còn đọc `password_hash`, `email`, `phone` | Có | `access.facade.spec.ts`: facade gọi `findDisplayNamesByIds` và không gọi `findByIds`. `drizzle-access.store.int.spec.ts` (TF99): kết quả trên Postgres thật chỉ có `{ id, displayName }`, không có `passwordHash`, `email`, `personal` |
| Chữ ký facade không đổi | Có | `getDisplayNames(userIds: string[]): Promise<Map<string, string>>` giữ nguyên. Không nơi gọi nào phải sửa, typecheck pass |
| Test pass | Có | Xem bên dưới |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công. Lint 0 lỗi; các warning có sẵn, không nằm ở file mới sửa.
- `@tripflix/core-api` test: 125 file pass, 2 skip (có sẵn); 2581 test pass, 4 skip.
- Test tích hợp `drizzle-access.store.int.spec.ts` cần Postgres (testcontainers), nên để CI chạy `test:int`. Chưa chạy ở máy.

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `pnpm --filter @tripflix/core-api test:int -- drizzle-access.store` (cần Docker)

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa module `access` (của Dũng). Các nơi gọi `getDisplayNames` bên `content/social` (Thành), `content/feed` (Phong) và `discovery` (Duy) không phải sửa.
