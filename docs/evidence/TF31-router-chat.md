# TF31 — Hạn mức gateway cho trợ lý Tripi (`POST /ai/chat`)

- Notion: TF31 · Nhánh: `bao/TF31-router-chat` · Người làm: Bảo (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Thêm middleware `rate-limit-chat` (trung bình 20 request/phút mỗi IP, dồn tối đa 5) vào `deploy/traefik/dynamic.yml` và `server.yml`.
  - Lý do: mỗi lượt chat gọi LLM, chặt hơn `rate-limit-api` (50 request/giây).
- **Dev (`dynamic.yml`):** thêm router `ai-chat` (`POST /ai/chat`, priority 100). Router `ai` giữ nguyên `rate-limit-api` cho các đường `/ai` khác.
- **Server (`server.yml`):** router `ai-chat` có sẵn, đổi `rate-limit-api` thành `rate-limit-chat`.
- `deploy/traefik/README.md`: thêm dòng vào bảng hạn mức. Ghi rõ hạn mức theo người dùng nằm trong ai-service.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| `/ai/chat` có hạn mức riêng ở gateway | Đạt | API Traefik liệt kê `ai-chat@file` → `rate-limit-chat@file {average: 20, period: 1m, burst: 5}` |
| Vượt hạn mức thì gateway trả 429 | Đạt | 30 request song song: 5 qua, 25 nhận `429` |
| Không siết các đường `/ai` khác | Đạt | 30 `GET /ai/health` song song: không có `429` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công.
- Traefik local: `docker restart tripflix-traefik-1`.
  - Bind-mount một file trên Docker Desktop (Windows) không báo thay đổi, nên phải khởi động lại.
  - Kiểm bằng `wget http://localhost:8080/api/http/routers` trong container.
- Bắn 30 `POST /ai/chat` song song (body `{}`): 25 × `429`, 5 × `502`.
  - `502` vì ai-service local chạy ngoài Docker. Request chưa tới LLM.

## Cách kiểm lại
1. `pnpm stack:be`, rồi `docker restart tripflix-traefik-1`.
2. Chạy:
   ```
   seq 1 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'content-type: application/json' -d '{}' http://localhost:8080/ai/chat | sort | uniq -c
   ```
   Kết quả đúng: khoảng 25 dòng `429`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `deploy/traefik/*` (Dũng; cấu hình chung: Tech Lead). Chỉ thêm 1 middleware và 1 router dev, đổi middleware của router `ai-chat`. Đã soạn tin báo, chờ đồng ý trước khi mở PR.
- Trên server, Traefik cần nạp lại cấu hình sau khi deploy (anh Phong).
