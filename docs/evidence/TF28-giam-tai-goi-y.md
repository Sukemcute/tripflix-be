# TF28 — Giảm tải gợi ý: bỏ trang rỗng, khoá job không chiếm pool

- Jira: TF28 · Nhánh: `duy/TF28-giam-tai-goi-y` (từ `develop` `c336f60`) · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-20

## Đã làm
- **Trang gợi ý rỗng kèm cursor** (`post-recommendations.use-cases.ts`): `nextCursor` được tính trước khi hydrate lọc bài đã ẩn / video chưa phát được, nên có trang trả `items: []` mà vẫn có `nextCursor` và client gọi tiếp ngay. Thêm `firstFilledPage` dùng chung cho `recommend` và `recommendReels`: trang bị lọc hết mà còn trang sau thì server tự lấy trang kế, tối đa 3 lần mỗi request. Contract API không đổi, FE không phải sinh lại client.
- **Khoá job chiếm pool** (`drizzle-recommend.store.ts`): `withLock` (dùng bởi `BuildFeatures`, `BuildProductFeatures`, `PurgeInteractions`) giữ một kết nối cho `pg_try_advisory_lock` suốt lượt job, kể cả lúc chờ `/embed`. Trước đây kết nối này lấy từ pool `discovery` (5), nên search và gợi ý chỉ còn 4. Giờ mở kết nối riêng ngoài pool (cùng cấu hình), đóng khi xong, có bắt sự kiện `error` để đứt kết nối không làm sập tiến trình.
- Không nâng pool: giữ giới hạn 5 cố ý của `docs/architecture/11 §3.3` (search không chen module khác khi dùng chung instance).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Không còn trang `items: []` kèm `nextCursor` khi phía sau còn bài | Có | `post-recommendations.use-cases.spec.ts` › "trang bị lọc hết sau hydrate" (4 test) |
| Không mất / trùng / đổi thứ tự bài khi cuộn | Có | Đo 1 bên dưới: danh sách bài cũ và mới giống hệt ở 4 kịch bản |
| Chất lượng xếp hạng không đổi | Có | Đo 2: `recommend-eval` sinh lại `report.md` trùng từng byte |
| Lúc job giữ khoá, pool vẫn đủ 5 chỗ | Có | `drizzle-recommend.store.int.spec.ts` › "khoá advisory giữ kết nối riêng" (fail trên code cũ: hết thời gian chờ kết nối; pass trên code mới) |
| Khoá vẫn loại trừ lượt chạy song song | Có | `drizzle-recommend.store.int.spec.ts` › "khoá advisory: lượt thứ hai cùng lúc bỏ lượt" |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck --affected`: 36/36 task pass.
- Test unit `post-recommendations.use-cases.spec.ts`: 32/32 pass.
- Test tích hợp `discovery` (Postgres thật, `vitest.int.config.ts`): 4 file, 21/21 pass.
- `vitest run` cả `core-api`: 3059 pass, 5 fail (e2e `access/service-token`, `access/auth`, `access/staff`, `content/moderation`, và `discovery/recommend/eval/recommend-eval.spec.ts` › "ghi kết quả…"). Không do thay đổi này: chạy cùng bộ trên `develop` gốc cũng fail (danh sách đổi theo lần chạy), chạy riêng từng file thì pass; lỗi là `Test timed out in 5000ms` khi máy tải nặng. `recommend-eval` không đi qua hai file đã sửa.

### Đo cũ / mới (cùng kịch bản, chỉ đổi code)
**Đo 1 — cuộn hết feed** (giả lập client gọi tới khi hết cursor; 60 bài hot + 10 khám phá, `limit` 5):

| Kịch bản | Request cũ → mới | Trang rỗng cũ → mới | Danh sách bài |
|---|---|---|---|
| Posts, không bài ẩn | 14 → 14 | 0 → 0 | giống hệt |
| Posts, 20 bài liền nhau bị ẩn | 14 → 14 | 0 → 0 | giống hệt |
| Reels, 12 video chưa xử lý xong | 14 → 14 | 0 → 0 | giống hệt |
| Reels, 40 video lỗi | 14 → 13 | 1 → 0 | giống hệt |

Trang có xen ô khám phá nên hiếm khi bị lọc sạch; thay đổi này là lưới an toàn, không tăng tốc rõ.

**Đo 3 — tải khi job đang giữ khoá** (Postgres thật, pool 5, mỗi request `pg_sleep(0.2)`, bắn 6 giây):

| Tải danh nghĩa | Cũ p50 / p95 | Mới p50 / p95 |
|---|---|---|
| 15 req/s | 203 / 211 ms | 203 / 212 ms |
| 22 req/s | 316 / 490 ms | 203 / 210 ms |
| 30 req/s | 817 / 1385 ms | 204 / 212 ms |

Giới hạn: tải thật thấp hơn danh nghĩa (bộ hẹn giờ Windows); `pg_sleep` không tốn CPU nên số tuyệt đối khác VPS 2 vCPU. Chỉ dùng để so cũ với mới. Script đo là file tạm, không commit.

## Cách kiểm lại
1. `cd apps/core-api && npx vitest run src/modules/discovery/recommend/application/post-recommendations.use-cases.spec.ts`
2. Cần Docker: `npx vitest run --config vitest.int.config.ts src/modules/discovery/recommend/infra/drizzle-recommend.store.int.spec.ts`
3. Muốn thấy test khoá fail trên code cũ: `git stash` riêng `drizzle-recommend.store.ts` (hoặc checkout file từ `develop`) rồi chạy lại bước 2.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa trong `discovery` (`apps/core-api/src/modules/discovery/recommend/`).
