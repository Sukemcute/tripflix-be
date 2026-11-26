# TF119 — Tách config AI trên server sang `.env.ai`, Bảo tự sửa qua `ai-config.sh`

- Jira: [SCRUM-191](https://tripflix.atlassian.net/browse/SCRUM-191) · Nhánh: `phong/TF119-tach-config-ai` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-26

## Đã làm
- `deploy/compose.server.yaml`: ai-service, ai-summary-worker, ai-label-worker đọc `env_file: .env.ai` (bắt buộc có). Bỏ 25 dòng biến AI khỏi `environment:`; giữ địa chỉ nội bộ, CORS, `FORWARDED_ALLOW_IPS`, `SERVICE_CLIENT_*`, `CLASSIFIER_THREADS`. Vì `environment:` ghi đè `env_file:`, biến deploy quản không bị `.env.ai` thay được.
- `deploy/.env.ai.example` (mới): đủ biến AI, mặc định đúng như compose cũ, kèm ghi chú vận hành chuyển từ compose sang.
- `deploy/ai-config.sh` (mới): forced command cho user `bao`, cùng cách với `deploy-api.sh` (chuyển sang user chạy compose bằng sudo, tham số chỉ đọc từ `SSH_ORIGINAL_COMMAND`). Lệnh `get`, `set`, `status`, `logs`. `set` kiểm file, backup (giữ 20 bản), ghi, chạy lại 3 service AI dưới khoá chung với deploy, đợi 20 giây rồi kiểm container không khởi động lại; không đạt thì trả bản cũ. Phần ghi chạy trong session riêng nên SSH đứt vẫn chạy tới cuối. Nhật ký chỉ ghi tên biến đổi, không ghi giá trị.
- `deploy/ai-config.test.sh` (mới): test với `docker` giả, chạy trong Debian 12.
- `deploy/init-server-env.sh`: server mới sinh cả `.env.ai` (salt Tripi sinh sẵn); bỏ biến AI khỏi mẫu `.env.server`.
- `deploy/SERVER.md`: mục mới "Config AI (`.env.ai`)" (cách Bảo dùng, chuyển staging có lệnh so env trước/sau, cài user `bao`, tunnel IAP); 11 chỗ trong Giai đoạn 5 đổi từ `.env.server` sang `.env.ai`.
- `.gitignore`: cho commit `deploy/.env.ai.example`; `.env.ai` thật và file tạm `.env.ai.new.*` vẫn bị bỏ qua.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Jira) | Đạt | Bằng chứng |
|---|---|---|
| 3 service AI đọc config từ `.env.ai`; biến môi trường cũ giữ nguyên giá trị | Đạt (repo) | `docker compose config` với env giả trước/sau: 35/35 biến cũ giữ đúng giá trị |
| Bảo dùng `get`, `set`, `status`, `logs`; không shell, không Docker, không đọc `.env.server` | Đạt (repo), chờ cài trên staging | `ai-config.test.sh`: lệnh lạ, `apply` gọi thẳng qua SSH đều bị chặn (mã 2); forced command + sudoers chỉ cho đúng script |
| `set` từ chối và không đổi gì khi file sai | Đạt | `ai-config.test.sh`: CR, sai dạng, trùng tên, `LD_PRELOAD`, `PYTHONPATH`, `REDIS_URL`, 3 kiểu giá rỗng, thiếu `LLM_PROVIDER`, file quá 64 KB |
| Service không chạy ổn thì trả bản cũ; backup, nhật ký chỉ tên biến | Đạt | `ai-config.test.sh`: ca `LLM_PROVIDER=broken` trả bản cũ, tạo lại 2 lần, nhật ký ghi lần lỗi; output không chứa giá trị key |
| Server mới sinh `.env.ai`; `SERVER.md` có hướng dẫn | Đạt | Chạy `init-server-env.sh` vào thư mục tạm: cả 2 file quyền 600, salt 64 ký tự, `.env.server` không còn biến AI, không ghi đè file có sẵn |
| Staging đã chuyển; Bảo đổi thử một biến | Chưa | Làm sau khi PR merge, cập nhật evidence |

## Kết quả kiểm tra
- `docker compose -f compose.server.yaml --env-file <env giả> --profile ai config`: so biến cuối cùng của 3 service trước/sau. 35/35 biến cũ giữ đúng giá trị. Worker nhận thêm biến AI khác (dùng chung file); tripflix-ai đặt `extra="ignore"` cho cả 3 lớp settings nên không ảnh hưởng.
- Đặt `REDIS_URL=redis://evil:6379` trong `.env.ai`: compose vẫn ra `redis://redis:6379`.
- Thiếu `.env.ai`: profile `ai` báo lỗi rõ; profile `api` (deploy core-api tự động) vẫn chạy.
- `docker compose ... config -q` đủ mọi profile với `.env.ai` mẫu: hợp lệ.
- `ai-config.test.sh` trong `debian:bookworm-slim`: **56 đạt, 0 lỗi**.
- `pnpm turbo run lint typecheck test --affected`: chưa chạy, worktree chưa cài `node_modules`. Thay đổi chỉ trong `deploy/`, `.gitignore`, `docs/`, không đụng package nào.

## Cách kiểm lại
1. `docker run --rm -v "$PWD/deploy:/w:ro" debian:bookworm-slim sh /w/ai-config.test.sh`
2. `cp deploy/.env.ai.example deploy/.env.ai`, chạy `docker compose -f deploy/compose.server.yaml --env-file <env giả> --profile ai config` và xem `environment` của 3 service AI, rồi xoá `deploy/.env.ai`.
3. Trên staging sau khi merge: làm theo `deploy/SERVER.md`, mục "Tạo `.env.ai` lần đầu"; lệnh so env không in dòng nào là đạt.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: config AI là của Bảo (tên biến, ý nghĩa, mặc định chuyển sang `.env.ai.example`). Cần Bảo duyệt PR. Không đổi code tripflix-ai, không đổi `deploy/compose.yaml` (máy local vẫn dùng `deploy/.env`).
