# TF09 — Phần 4: API cấp và ký lại link upload

- Notion: TF09 · Nhánh: `phong/TF09-media-upload-api` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-04

PR này là một phần của TF09, nên chưa đạt hết tiêu chí của task. `complete` làm sau, khi có `@Transactional` và outbox.

## Đã làm
- `POST /api/media/uploads`: kiểm giới hạn, tạo phiên upload trên S3, lưu `media_assets`, ký link từng phần.
- `POST /api/media/uploads/:assetId/parts`: ký lại link cho các phần còn thiếu.
- Gọi S3 trước khi ghi database, vì `RULES.md` cấm gọi dịch vụ ngoài trong transaction. Ghi database lỗi thì lifecycle của S3 xoá phiên dở sau 1 ngày.
- Các biến S3 trong `platform/env.ts` có giá trị mặc định, để máy chưa cấu hình AWS vẫn khởi động được.
- Lỗi nghiệp vụ trả `{ code, message }` theo docs Feed. `ZodBody` viết lại trong media vì module không được import vào bên trong `access`.

## Quyết định ngoài docs Feed
| Quyết định | Lý do |
|---|---|
| `durationSec` lẻ thì làm tròn lên | Cột là số nguyên; làm tròn lên để 300,5 giây vẫn bị từ chối |
| `/parts` trả `409 MEDIA_UPLOAD_NOT_ACTIVE` khi video không còn `uploading` | Ký link cho phiên đã xong là vô nghĩa; mã lỗi mới, đã thêm vào docs Feed |
| Số phần ngoài phạm vi trả `400 MEDIA_INVALID_PART_NUMBER` | Đây là lỗi của app |
| File gốc dùng đuôi theo `mimeType` (`.mp4`, `.mov`) | App được gửi cả `video/quicktime` |
| Chưa nhận `Idempotency-Key` | `libs/idempotency` chưa có. Gửi lại chỉ tạo thêm một dòng `uploading` thừa, không mất dữ liệu hay tiền. Thêm khi thư viện có |

## Đối chiếu tiêu chí
| Tiêu chí của phần này | Đạt | Bằng chứng |
|---|---|---|
| Video tối đa 5 phút, 1 GB, trả `422 MEDIA_TOO_LARGE` | Có | `upload-rules.spec.ts`, `media-upload.e2e.spec.ts`, thử thật |
| Mỗi phần 10 MB, link sống 1 giờ | Có | `upload-rules.spec.ts`, `media-upload.e2e.spec.ts` |
| Link từ API PUT được lên S3 thật | Có | Thử thật: PUT 2 phần, một phần qua link ký lại |
| Ký lại phần còn thiếu | Có | `media-upload.e2e.spec.ts`, thử thật |
| Chỉ chủ video gọi được | Có | E2E và thử thật: người khác trả 404, chưa đăng nhập trả 401 |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test build --affected`: 40/40 task đạt. Core-api 54/54 test đạt, trong đó có 36 test mới cho media; storage 18/18, auth 14/14, notification-service 4/4, config 2/2, contracts 2/2.
- Sau khi gộp `develop` (có `@Transactional` của Dũng), chạy đủ các bước của CI, tất cả thoát mã 0: `pnpm lint` (có kiểm ranh giới module), `pnpm typecheck`, `pnpm test` (core-api 64/64), `pnpm test:int` (core-api 9/9), `pnpm build`, `pnpm contracts:build` (`contracts/` không đổi). E2E của media import `access` qua `access/index.ts` (Dũng export ở PR #15), đúng ranh giới module.
- Thử thật với core-api, Postgres local, S3 dev (trước khi gộp `develop`, chưa chạy lại): 11/11 đạt; file 11 MB hoàn tất trên S3 có dung lượng khớp với lúc xin link. Bước hoàn tất gọi trực tiếp `libs/storage`, vì API `complete` chưa có. Đã xoá user, video thử.
- Chưa có test tự động cho `DrizzleMediaAssetStore`; repository này mới được kiểm qua lần thử thật.

## Cách kiểm lại
1. `pnpm install`, rồi `pnpm --filter @tripflix/core-api test`.
2. Thử thật: thêm `AWS_REGION`, key AWS, `S3_KEY_PREFIX=dev/<tên>/` vào `apps/core-api/.env`, rồi `pnpm --filter @tripflix/core-api dev`.
3. Đăng nhập, gọi `POST /api/media/uploads`, PUT file lên từng link. Không gửi header `Authorization` tới link S3.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- `platform/env.ts`, `apps/core-api/.env.example`: thêm biến S3, đều có giá trị mặc định nên không ảnh hưởng tới máy khác.
- `apps/core-api/package.json`, `pnpm-lock.yaml`: thêm `@tripflix/storage`, cần chạy `pnpm install` một lần.
- `content/content.module.ts` (dùng chung với Thành, Trang): thêm import `MediaModule`.
- `contracts/openapi/core-api.json`: thêm 2 API, sinh bằng `pnpm contracts:build`. Trang chạy `pnpm gen:api` bên FE để có client.
