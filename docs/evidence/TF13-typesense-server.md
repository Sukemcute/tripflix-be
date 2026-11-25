# TF13 — Bật Typesense trên server staging

- Notion: TF13 · Nhánh: `phong/TF13-typesense-server` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-25

## Đã làm
- `deploy/compose.server.yaml`:
  - Thêm service `typesense` cùng profile `api`, dùng image `typesense/typesense:29.0` theo gợi ý của Duy ở PR #329.
  - Không mở cổng, giới hạn `mem_limit: 1g`, dùng volume riêng `typesense-data`.
  - Snapshot đặt 300 s, write buffer đặt 64 MB.
  - Healthcheck dùng bash `/dev/tcp`.
- core-api:
  - Thêm `SEARCH_BACKEND` (mặc định `typesense`, có thể đổi trong `.env.server` để quay lui mà không cần PR).
  - Ghi thẳng `TYPESENSE_HOST: typesense` và cổng `8108`.
  - `TYPESENSE_API_KEY` bắt buộc (`:?`).
  - Đợi `typesense` healthy rồi mới chạy.
- `deploy/init-server-env.sh`: server mới tự sinh `TYPESENSE_API_KEY`.
- `deploy/.env.example`: thêm hai biến `TYPESENSE_API_KEY` và `SEARCH_BACKEND`.
- `deploy/SERVER.md`: thêm mục "Tìm kiếm: Typesense (TF13)", gồm các bước bật lần đầu, thứ tự đặt key và cách quay lui.
- Deploy tự động chỉ kéo image, không chép `compose.server.yaml`. Vì vậy merge xong vẫn phải chép file compose mới lên server bằng tay.

## Kết quả kiểm tra
- `docker compose -f compose.server.yaml --env-file <env giả> --profile api config` hợp lệ:
  - typesense không có `ports`, `mem_limit` là 1 GiB.
  - core-api nhận đủ 6 biến `SEARCH_BACKEND`/`TYPESENSE_*`, và `depends_on` gồm `migrate`, `redis`, `typesense`.
- Bỏ `TYPESENSE_API_KEY` khỏi env thì compose báo lỗi `required variable TYPESENSE_API_KEY is missing a value`, đúng như mong đợi.
- Chạy `typesense/typesense:29.0` ở máy local, rồi chạy đúng lệnh healthcheck: đạt sau 4 giây.
- Chưa bật trên server.

## Cách kiểm lại (sau khi bật trên server)
1. `dc --profile api ps`: `typesense` và `core-api` đều healthy.
2. Log core-api có dòng `Đã dựng chỉ mục tìm khám phá: N mục`.
3. Tìm "resort đà nẵng" trên web có kết quả.
4. `docker stats --no-stream`: RAM typesense khoảng 0,5–0,7 GB.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa trong `deploy/` (Phong phụ trách). Code core-api và discovery của Duy giữ nguyên.
