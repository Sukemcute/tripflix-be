# TF28 — Nâng RAM ai-service cho POST /embed

- Nhánh: `phong/TF28-ai-ram` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-19

## Đã làm
- Duy thêm `POST /embed` vào ai-service (tripflix-ai #49, `sha-6a5eb2b`): nhúng caption bằng e5-small INT8, model đóng sẵn trong image, nạp khi core gọi lần đầu, chạy 1 luồng ONNX có khoá.
- Đổi `mem_limit` của ai-service từ `1g` lên `1536m`. ai-service lúc chờ khoảng 290 MiB, ViSoBERT khi bật đạt đỉnh khoảng 640 MiB, e5 thêm khoảng 380 MiB: tổng khoảng 1,03 GiB, vượt 1g thì container bị kill và mất cả `/moderate`, `/chat`. CPU giữ 0,5 nhân (e5 khoảng 45 caption/giây, đủ cho job 10 phút một lần).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| ai-service staging có giới hạn 1536m | Chưa | `docker inspect -f '{{.HostConfig.Memory}}'` ra `1610612736` |
| Máy còn đủ RAM | Chưa | `free -m`, `docker stats --no-stream` trước khi đổi |
| `/embed` chạy trên staging | Chưa | core gọi được sau khi tripflix-be #277 merge |

## Kết quả kiểm tra
- `docker compose -f deploy/compose.server.yaml --profile ai config --no-interpolate -q`: đạt.

## Cách kiểm lại
1. Server: `docker inspect -f '{{.HostConfig.Memory}}' $(dc ps -q ai-service)` ra `1610612736`.
2. Sau khi core gọi `/embed`: `docker stats --no-stream` thấy ai-service dưới 1,5 GiB, không có `OOMKilled`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `deploy/` (Phong), theo yêu cầu của Duy.
