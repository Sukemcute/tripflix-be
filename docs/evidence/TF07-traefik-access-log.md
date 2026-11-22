# TF07 — Bật access log cho Traefik trên server

- Notion: (chưa có link) · Nhánh: `dung/TF07-traefik-access-log` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- `deploy/compose.server.yaml`: thêm `--accesslog=true`, `--accesslog.format=json` cho service `traefik`. Log ra stdout, xoay vòng theo `logging: *logging` sẵn có (json-file 10 MB × 3).
- `deploy/traefik/server.yml`: thêm router `web-token-links` cho `/dat-lai-mat-khau`, `/xac-thuc-email` với `observability.accessLogs: false`, vì link trong email mang `?token=`.
- `deploy/traefik/README.md`: ghi cách xem log và lưu ý dữ liệu cá nhân.
- Mục đích: xem được từng request vào hệ thống (kể cả khách chưa đăng nhập) và đọc số liệu phía server khi test tải.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Traefik bật access log JSON | Có | 2 cờ trong `compose.server.yaml` |
| Link mang token không bị ghi log | Có | Router `web-token-links`, `observability.accessLogs: false` |
| Không đầy ổ đĩa | Có | Dùng logging json-file 10 MB × 3 sẵn có |
| Cấu hình hợp lệ | Có | Chạy thử container `traefik:v3.7` tạm trên server với `server.yml` mới: nạp đủ router, không có lỗi |

## Kết quả kiểm tra
- Parse YAML 2 file bằng PyYAML: OK.
- Container `traefik:v3.7` tạm (không mở cổng, tự xoá sau 10 giây) trên server, `--log.level=DEBUG`: router `web-token-links@file` được tạo, observability `accessLogs: false`, không có dòng lỗi.
- Chưa chạy `pnpm turbo run lint typecheck test --affected`: thay đổi chỉ ở `deploy/` và docs, không có code TypeScript.

## Cách kiểm lại
1. Sau khi deploy: `dc up -d traefik` (Traefik khởi động lại vài giây).
2. `dc logs -f --tail 50 traefik`, mở web: mỗi request là một dòng JSON có `ClientHost`, `RequestPath`, `DownstreamStatus`, `Duration`.
3. Mở `https://<WEB_HOST>/dat-lai-mat-khau?token=x`: không có dòng log nào cho request này.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `deploy/` thuộc Phong. Phong đề xuất router `web-token-links` và đồng ý bật access log. Log có IP người dùng: chỉ xem nội bộ, giữ khoảng 30 MB xoay vòng.
