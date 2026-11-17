# TF100 — Tín hiệu realtime cho quản trị

- Phạm vi được người dùng chốt: thêm realtime BE + FE khi thiết kế lại toàn bộ admin.
- Nhánh: `trang/TF100-admin-realtime`. Phối hợp FE: `trang/TF100-thiet-ke-admin`. Codex thực hiện ngày 2026-11-17; chưa push/deploy.

## Thay đổi

- `libs/contracts`: schema `content.moderation.changed.v1` (`scope: case|appeal|scan`, `id`) và schema cho event `content.post.moderated.v1` đã có producer. Sinh artifact qua `pnpm contracts:build`, không sửa tay.
- Moderation ghi signal vào content outbox trong cùng transaction khi scan thay đổi, case được tạo/cập nhật, khiếu nại được gửi hoặc scan được lên lịch thử lại. Signal cũ (report/decided/direct moderation/held) tiếp tục được dùng.
- Notification consumer xác thực payload và version, gom thay đổi trong 250 ms rồi phát `moderation.changed` với payload `{}`. Giữ xử lý inbox/push hiện có.
- Gateway tự join `staff:moderation` chỉ khi token có vai trò moderator/superadmin. Không thêm API cho client xin join phòng staff. Redis adapter hiện tại phát qua các replica; cơ chế ngắt socket khi thu hồi phiên/vai trò được giữ nguyên.
- Browser admin nhận SSE qua BFF, token không ra trình duyệt. Chi tiết và ảnh kiểm thử ở evidence TF100 của repo FE.

## Kiểm tra

- `pnpm contracts:build`: pass.
- Kiểm tra `pnpm turbo run lint typecheck test --affected`: BE 49/49 task pass; FE 22/22 task pass. Các test parity/benchmark bị skip theo cấu hình sẵn có, không sửa test để bỏ qua.
- Gateway chỉ gửi `moderation.ready` sau khi staff đã vào phòng; BFF dùng xác nhận này để bật trạng thái cập nhật trực tiếp.
- `pnpm --filter @tripflix/notification-service test`: 18 file, 127 test pass. Có test member không nhận được event staff; test gom signal, bỏ payload/version sai và dọn timer.
- `pnpm --filter @tripflix/notification-service typecheck`, lint: pass (warning có sẵn trong test inbox/push).
- `pnpm --filter @tripflix/core-api typecheck`: pass.
- Moderation + pre-publication integration: 41 test Postgres thật pass (33 moderation, 8 pre-publication). Hai test mới xác nhận outbox signal và rollback scan/khiếu nại khi ghi event lỗi.
- `node tools/check-boundaries.mjs`: pass.
- FE test `realtime-bff.cjs` chạy production BFF với dịch vụ cục bộ giả lập: auth 401, cross-origin 403, nhận socket qua SSE, không lộ token/nội dung upstream và disconnect sau logout đều pass.

```powershell
pnpm --filter @tripflix/core-api exec vitest run --config vitest.int.config.ts src/modules/content/moderation/application/moderation.int.spec.ts src/modules/content/moderation/application/pre-publication.int.spec.ts
pnpm --filter @tripflix/notification-service test
```

## Ảnh hưởng

Moderation thuộc Trang; notification-service/contracts thuộc Dũng. Không đổi HTTP API, schema database hay migration. Thêm outbox dependency vào ba use case và cập nhật DI/test builders tương ứng. Khi release cần bật notification consumer và cấu hình `ADMIN_REALTIME_URL` để server admin tới được gateway `/ws`. Chưa chạy trên staging/production.
