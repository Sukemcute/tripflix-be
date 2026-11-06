# TF57 — Cho `turbo dev` chạy được trong Docker

- Jira: [SCRUM-61](https://tripflix.atlassian.net/browse/SCRUM-61) · Nhánh: `duy/TF57-turbo-dev-trong-docker` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-06

## Lỗi
`pnpm stack:up` trên develop: `core-api` thoát ngay với `You have 11 persistent tasks but turbo is configured for concurrency of 10`. Khi qua được lỗi này, Nest vẫn không đọc được `DATABASE_URL_*` vì turbo 2 chỉ chuyển các biến môi trường đã khai báo (image không có `.env`).

## Đã làm
- `turbo.json`: `"concurrency": "20"` (core-api có 11 task dev persistent: app + các lib ở chế độ watch).
- Task `dev`: `"passThroughEnv": ["*"]`, để mọi biến từ compose tới được app (core-api, notification-service, video-worker: `DATABASE_URL_*`, `AUTH_*`, `AWS_*`, `S3_*`, `REDIS_URL`...). Chỉ áp cho `dev` (không cache), không ảnh hưởng cache của `build`/`test`.
- **Giảm RAM:** Dockerfile dev của `core-api`, `notification-service`, `video-worker` chạy `turbo run dev --filter=${APP}` (bỏ `...`). Trước đây mỗi container mở thêm 10 tiến trình `tsc --watch` cho libs (~2,1 GB riêng core-api), trong khi app thật chỉ ~150–250 MB. Libs vẫn build một lần lúc khởi động (`dev` phụ thuộc `^build`).
- `deploy/compose.yaml`: dòng sync `libs` của 3 service đổi thành `sync+restart`, nên khi chạy `pnpm stack:watch`, sửa code trong `libs/` thì container tự khởi động lại và build lại lib (vài chục giây). Sửa trong `apps/<app>/src` vẫn hot reload như cũ. Image `prod` không đổi.

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck --filter=@tripflix/core-api`: 12/12 task pass.
- RAM (`docker stats`, stack local, đã chạy ổn định): core-api 3,44 GB → 1,36 GB; video-worker 1,19 GB → 0,44 GB; notification-service 0,97 GB sau khi sửa. API trả lời sau ~24 s từ lúc khởi động.
- Thử `compose watch`: thêm một dòng trống vào `libs/config/src/index.ts` → core-api, notification-service, video-worker tự khởi động lại, `/api/search` lên lại sau ~21 s; đã hoàn file.
- Stack local (`docker compose ... up`) với `turbo.json` này: `core-api`, `notification-service`, `video-worker` chạy; `POST /api/search` trả kết quả. Với `turbo.json` của develop: `core-api` thoát mã 1 với lỗi concurrency ở trên.

## Cách kiểm lại
1. `pnpm stack:up` (build lại image để lấy `turbo.json` mới).
2. `docker ps`: `tripflix-core-api-1` ở trạng thái Up; `docker logs tripflix-core-api-1` không còn lỗi concurrency.
3. Chạy thử video-worker với biến `AWS_*`, `S3_*`, `REDIS_URL` từ compose.

## Ảnh hưởng tới phần của người khác
- `turbo.json`, 3 Dockerfile (target `dev`), `deploy/compose.yaml` là cấu hình chung (Tech Lead). `libs/` (Dũng): không sửa code, chỉ đổi cách reload khi sửa libs trong Docker (khởi động lại container thay vì watch thường trực).
