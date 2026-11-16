# TF102 — Admin xem khoảng trống từ vựng của tìm kiếm (n-gram, G²)

- Jira: SCRUM-126 · Nhánh: `duy/TF102-khoang-trong-tu-vung` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Mỗi lượt tìm khám phá (`POST /api/search`) và trang đầu tìm bài (`POST /api/search/posts`) cộng n-gram 1–2 của câu vào bảng mới `discovery.search_query_grams` (theo ngày, tối đa 5 câu mẫu, không lưu người tìm). Ghi kiểu bắn rồi quên: lỗi chỉ log, không làm chậm hay hỏng lượt tìm.
- Chỉ đếm phần engine chưa hiểu: dùng `u.seq` (đã bỏ ngân sách, số ngày, từ dừng, nơi đã hiểu) và bỏ n-gram mà mọi từ đều đã khớp từ điển.
- `GET /api/v1/admin/search/vocab-gaps?days&limit&minCount` (moderator, superadmin): so log câu tìm với bộ đếm `ng` của chỉ mục bằng log-likelihood ratio G² (Dunning 1993; Rayson & Garside 2000), chỉ giữ cụm người tìm dùng nhiều hơn nội dung, gom kiểu viết gần nhau (Damerau-Levenshtein trên dạng bỏ dấu).
- Xoá đếm câu tìm quá 90 ngày trong `PurgeInteractionsJob` có sẵn.
- Không đổi sự kiện. OpenAPI thêm endpoint mới (`pnpm contracts:build`).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Endpoint trả danh sách từ dữ liệu tìm thật | Có | Stack local (`pnpm stack:be`), 17 lượt tìm thật qua API, `GET /api/v1/admin/search/vocab-gaps?days=1&minCount=2` → 200, đầu danh sách `nang tho` (5 lượt, nội dung 0 lần, 5 câu mẫu), `chill phet`. `days=0` → 400, không token → 401 |
| Test: G², gom biến thể, use case, controller | Có | `vocab-gaps.spec.ts`, `explore.use-cases.spec.ts` (mục TF102), `admin-vocab-gaps.controller.spec.ts`, `purge-interactions.job.spec.ts` |
| `pnpm turbo run lint typecheck test --affected` pass | Có | Xem dưới |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected --continue --concurrency=2`: lint 0 lỗi (core-api 112 cảnh báo có sẵn, không ở file của task), typecheck pass, test các lib và notification-service pass. core-api: 7 test e2e của access/content hết giờ 5 s khi chạy song song với cả repo; chạy riêng 4 file đó: 28/28 pass.
- `pnpm exec vitest run --maxWorkers=4` (core-api): 121 file pass, 2557 test pass, 4 skip.

## Cách kiểm lại
1. `pnpm stack:be`, chờ log "Đã dựng chỉ mục tìm khám phá".
2. Gọi `POST /api/search` vài lần với cụm chưa có trong nội dung (vd "cafe nàng thơ", "quán nàng thơ đà lạt").
3. Đăng nhập superadmin seed, gọi `GET /api/v1/admin/search/vocab-gaps?days=1&minCount=2`.

## Ảnh / video
- Không đổi giao diện (màn admin do Thành làm sau).

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa trong `discovery` (Duy). `contracts/openapi/core-api.json` chỉ thêm endpoint.
