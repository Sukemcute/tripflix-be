# TF09 — Sửa chuỗi snapshot migration của content

- Task: TF09 (SCRUM-13) · Nhánh: `phong/TF09-fix-content-migration-chain` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- `pnpm db:generate content` đang lỗi vì `init_media` và `plain_captain_cross` đều là snapshot gốc (`type: base`), do hai nhánh tạo migration đầu tiên song song. Migration `add_content_outbox` cũng chưa có snapshot.
- Sinh lại `snapshot.json` của `plain_captain_cross` bằng `drizzle-kit` thành dạng nối tiếp sau `init_media`, giữ nguyên `id`.
- Thêm `snapshot.json` cho `add_content_outbox`, nối tiếp sau `plain_captain_cross`.
- Không đổi file SQL nào. Migrator lúc chạy chỉ đọc `migration.sql`, nên database đã migrate không bị ảnh hưởng.

## Kết quả kiểm tra
- `drizzle-kit generate` của content: `No schema changes`, không sinh thêm migration.
- `drizzle-kit check` của content: `Everything's fine`.
- `git diff` với `origin/develop`: `migration.sql` của 3 migration và toàn bộ thư mục `init_media` không đổi.
- Chạy đủ các bước của CI, tất cả thoát mã 0: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int`, `pnpm build`, `pnpm contracts:build` (`contracts/` không đổi).

## Cách kiểm lại
1. `pnpm install && pnpm build`.
2. `pnpm db:generate content`: mong đợi không sinh migration mới.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `content/db/migrations` của Thành (`plain_captain_cross`, `add_content_outbox`), chỉ đổi và thêm `snapshot.json`. Thành đã đồng ý.
