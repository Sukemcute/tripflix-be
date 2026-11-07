# TF57 — Tách AI khỏi stack Docker mặc định

- Jira: [SCRUM-61](https://tripflix.atlassian.net/browse/SCRUM-61) · Nhánh: `trang/TF57-tach-ai-khoi-stack` (cả 3 repo) · Người làm: Lê Thị Thùy Trang (dùng AI: có) · Ngày: 2026-11-07

## Vấn đề
- `pnpm stack:up` luôn build và chạy `ai-service`, làm stack khởi động chậm, trong khi phần lớn thời gian code BE/FE không cần AI.
- Worker tóm tắt bài viết (`app.workers.summary_worker`) không có trong `compose.yaml`; container chạy tay `tripflix-ai-summary-worker` (restart `unless-stopped`) nên `pnpm stack:down` không tắt được, và nó restart liên tục khi Redis đã dừng.

## Đã làm
- `deploy/compose.yaml`: thêm service `ai-summary-worker` (profile `ai`, cùng image với `ai-service`, `command` chạy summary worker, `depends_on: redis`, watch `sync+restart` thư mục `app`).
- `package.json`:
  - `stack:up`, `stack:watch` bỏ profile `ai`.
  - Thêm `stack:ai` (bật AI lên stack đang chạy), `stack:ai:down` (tắt riêng AI), `stack:full`, `stack:watch:full` (cả hệ thống kèm AI).
  - `stack:down`, `stack:reset` giữ profile `ai` nên vẫn tắt cả AI.
- `ai-summary-worker` dùng `LLM_PROVIDER` mặc định `fake` và `LOG_LEVEL` riêng (`AI_WORKER_LOG_LEVEL`, mặc định `INFO`).
- `deploy/.env.example`: thêm `LLM_PROVIDER=fake`, `LLM_MODEL`, `SERVICE_CLIENT_SECRET`, `SUMMARY_LLM_KILL` (worker bắt buộc có `LLM_PROVIDER`).
- README của `tripflix-be`, `tripflix-fe`, `tripflix-ai`: cập nhật bảng lệnh và cách bật/tắt AI.

## Kết quả kiểm tra
- `docker compose ... config -q` (đủ 5 profile): hợp lệ. `--profile be --profile fe --profile gateway config --services` (tức `stack:up`): không có `ai-service`, `ai-summary-worker`. Profile của `stack:down` có cả hai.
- `prettier --check` trên `package.json` và README FE: pass. `deploy/compose.yaml`, README BE vốn đã lệch format trên `develop`, không sửa thêm.
- Chạy thật trên stack local (2026-11-07):
  - Lần đầu `ai-summary-worker` restart liên tục vì 2 lỗi, đã sửa trong compose: thiếu `LLM_PROVIDER` (giờ mặc định `fake` cho dev) và `LOG_LEVEL=debug` viết thường mà `logging` của Python không nhận (giờ dùng `AI_WORKER_LOG_LEVEL`, mặc định `INFO`).
  - Sau khi sửa: log `summary worker ... listening on stream:core.content`, container ở trạng thái Up.
  - `pnpm stack:ai:down`: `ai-service`, `ai-summary-worker` dừng; `core-api` vẫn healthy, `GET :3000/health` trả 200.
  - `pnpm stack:ai`: hai service AI chạy lại.
- Không chạy `pnpm stack:down` để khỏi tắt stack đang dùng; kiểm bằng `config --services` như trên.
- Không đổi code TypeScript/Python nên không chạy lại `pnpm test`.

## Cách kiểm lại
1. (Tuỳ chọn) đặt `LLM_PROVIDER` trong `deploy/.env`; không đặt thì dev dùng `fake`.
2. Nếu còn container cũ: `docker rm -f tripflix-ai-summary-worker`.
3. `pnpm stack:up` → `pnpm stack:ps` không có `ai-service`, `ai-summary-worker`.
4. `pnpm stack:ai` → hai service AI chạy; `docker logs tripflix-ai-summary-worker-1` có dòng `listening on stream:core.content`.
5. `pnpm stack:down` → không còn container nào của project `tripflix`.

## Ảnh hưởng tới phần của người khác
- `deploy/compose.yaml`, `package.json` là cấu hình chung (Tech Lead). Ai quen chạy `pnpm stack:up` để có AI thì giờ dùng `pnpm stack:full` hoặc thêm `pnpm stack:ai`.
