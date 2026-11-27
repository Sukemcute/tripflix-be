# TF28 — Admin chỉnh số ứng viên gợi ý for_you

- Notion: TF28 · Nhánh: `duy/TF28-chinh-ung-vien-admin` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-27

## Đã làm

Đo tải ngày 27/11 cho thấy Reels/for_you bị giới hạn bởi CPU của core-api. Ranker `trip_v1` xếp hạng toàn bộ ứng viên hot cho mỗi phiên. Muốn đổi số ứng viên thì phải sửa code rồi deploy, lại không thấy được việc xếp hạng tốn bao lâu. PR này cho admin chỉnh con số đó lúc chạy và theo dõi được kết quả.

- `RecommendTuning` (port) + `RedisRecommendTuning`: lưu ở khoá `discovery:recommend:candidate-limit`, không hết hạn. Xoá khoá là về mặc định.
- `PostRecommendationUseCases`:
  - Chỉ khi ranker đọc nhiều bài (`candidateLimit` có giá trị, hiện là `trip_v1`) mới lấy số admin đặt thay cho mặc định trong code.
  - Số này được cache 1 phút.
  - Giá trị ngoài khoảng 200–5.000, hoặc Redis lỗi, thì dùng mặc định.
  - Thời gian xếp hạng của 200 phiên gần nhất được ghi lại để tính p50/p95.
- API admin:
  - `PUT /api/v1/admin/discovery/jobs/candidate-limit`:
    - chỉ superadmin;
    - body `{ "limit": 200..5000 | null }`, với `null` là về mặc định;
    - nếu ranker hiện tại không dùng ứng viên thì trả 400.
  - `GET .../recommend` (stats) trả thêm `candidateLimit`:
    - `limit`, `defaultLimit`, `isOverridden`, `min`, `max`;
    - `rankTiming`: `samples`, `p50Ms`, `p95Ms`.
- Mặc định vẫn lấy từ ranker. PR này độc lập với PR #345 (hạ mặc định từ 5.000 xuống 1.000).
- `contracts/openapi/core-api.json` được sinh lại. API chỉ thêm, không đổi cái cũ.

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Admin đổi số ứng viên không cần deploy | ✅ | `admin-discovery-jobs.controller.spec.ts` › "số ứng viên gợi ý for_you" |
| Giá trị sai/Redis lỗi không làm hỏng gợi ý | ✅ | `post-recommendations.use-cases.spec.ts` › "số ứng viên admin đặt (trip_v1)": null/50/99999/Error → mặc định |
| Thấy được số đang dùng và thời gian xếp hạng | ✅ | Stats nhóm gợi ý có `candidateLimit.rankTiming`; test describe + timing |
| Ranker không dùng ứng viên (`tag_affinity_v0`) giữ nguyên | ✅ | Test "tag_affinity_v0 giữ 150, limit null" |
| Chỉ superadmin được ghi | ✅ | Test roles của controller |

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --affected --concurrency=2`: 49/49 task pass. Lint chỉ có warning có sẵn.
- `pnpm --filter @tripflix/core-api test`:
  - 207 file pass, 2 skipped;
  - 3.254 test pass, 4 skipped.

## Cách kiểm lại

1. `pnpm stack:up`, rồi đăng nhập admin bằng tài khoản superadmin.
2. Gọi `GET /api/v1/admin/discovery/jobs/recommend` và xem `candidateLimit`.
3. Gọi `PUT /api/v1/admin/discovery/jobs/candidate-limit` với body `{"limit": 2000}`. Kết quả trả về có `limit: 2000` và `isOverridden: true`.
4. Mở Reels for_you vài lần, gọi lại stats: `rankTiming.samples` tăng.
5. Gọi PUT với `{"limit": null}` để về mặc định.

## Ảnh / video

- Không đổi giao diện ở repo này. Panel admin ở PR FE riêng.

## Ảnh hưởng tới phần của người khác

- Không. Chỉ sửa trong `discovery` (của Duy) và sinh lại `contracts/`.
