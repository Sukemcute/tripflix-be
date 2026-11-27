# TF28 — Gợi ý for_you xếp 1.000 ứng viên thay vì 5.000

- Jira: TF28 · Nhánh: `duy/TF28-giam-ung-vien-recommend` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-27

## Bối cảnh

Đo tải Reels qua `/api/recommendations/reels` (hướng c của TF120: Reels đọc từ recommend) cho thấy nút thắt nằm ở CPU của core-api, không ở Postgres. Trang đầu `for_you` / `mixed` tốn 90–170 ms CPU Node để `trip_v1` xếp tới 5.000 ứng viên hot; Node một luồng nên đó là trần thông lượng. Trang sau chỉ 6–16 ms nhờ cache phiên.

Câu hỏi: xếp ít ứng viên hơn thì kết quả có tệ đi không?

## Đã làm

- `trip_v1.candidateLimit` 5.000 → 1.000 (`recommend/domain/rankers/trip-v1.ts`). Nguồn gu (Typesense) và fresh 48 giờ vẫn bổ sung như cũ.
- Cập nhật hai comment ở `post-recommendations.use-cases.ts` và hai assertion `limit` ở spec.

## Đo chất lượng theo số ứng viên

200 người mô phỏng có tương tác, Reels `for_you` (`postType=video`), DB local 41.314 bài / 8.255 bài video. Gọi thẳng bước xếp hạng của phiên (không ghi lịch sử đã phục vụ, nên các lượt không ảnh hưởng nhau), so với bản 5.000. Chạy lại cùng mức 5.000 ra y hệt: xếp hạng không ngẫu nhiên.

| Ứng viên | Thời gian xếp / người | Top 10 trùng bản 5.000 | Top 50 trùng | Điểm top 10 so với 5.000 | Top 10 có lý do theo gu |
|---|---|---|---|---|---|
| 5.000 | 136 ms | 100% | 100% | 100% | 60,7% |
| 3.000 | 92 ms | 80% | 64% | 99,6% | 60,5% |
| 2.000 | 69 ms | 70% | 49% | 99,3% | 60,0% |
| **1.000** | **52 ms** | 62% | 38% | **98,1%** | **61,3%** |
| 500 | 42 ms | 24% | 14% | 91,1% | 61,2% |

- Danh sách đổi nhiều nhưng điểm gần như giữ: có nhiều bài điểm sát nhau, cắt bớt thì ranker lấy bài khác điểm tương đương. Một phần do dữ liệu bench (38k bài là bản sao ×12 của ~3k bài, chỉ đổi tên nơi), nên tỉ lệ trùng thấp hơn thực tế; tỉ lệ điểm đáng tin hơn.
- Dưới 1.000 bắt đầu tụt rõ (500: điểm −9%).
- Bài lọt top 50 nằm ở hạng hot trung vị ~2.300: ranker chọn theo gu chứ không theo hot. Hướng lâu dài là lấy thêm ứng viên theo ngăn có index (thiết kế v1 mục 3.2), không đọc nhiều bài hot.

## Đo tải (k6)

Postgres, Redis, Typesense và core-api (image prod build từ nhánh, `APP_ROLE=all`, chu kỳ job mặc định) ghim chung 4 lõi để giống VM staging 4 vCPU; k6 chạy lõi khác. 50 người đăng nhập, mỗi request 30% trang đầu (`fresh=true`), 70% trang 2–5; mỗi mức 60 giây. Bền vững: p95 < 500 ms, lỗi < 1%.

Hiệu chuẩn: chạy lại đúng phép đo feed trộn của TF120 trên local thì đạt 20 req/s, gãy 25; staging đạt 10, gãy 15. Staging chịu khoảng ½ local.

| Kịch bản | 5.000 ứng viên | 1.000 ứng viên |
|---|---|---|
| Reels `mixed`, mức bền vững cao nhất | 20 req/s (p95 308 ms); 30 req/s p95 8,8 s | **50 req/s** (p95 153 ms); 60 req/s p95 1,4 s |
| Reels `for_you`, mức bền vững cao nhất | 20 req/s (p95 358 ms); 30 req/s p95 8,6 s | **40 req/s** (p95 98 ms); 50 req/s p95 1,1 s |
| CPU core-api ở mức cao nhất (% 1 lõi) | 109–119% | 62–88% |

Ước trên staging: Reels qua recommend ~20–25 req/s (trước ~10). Ở 1.000 ứng viên nút thắt chuyển sang Postgres (110–145%).

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Chất lượng xếp hạng không giảm đáng kể | Có | Bảng trên: điểm top 10 giữ 98,1%, tỉ lệ lý do theo gu 61,3% (5.000: 60,7%) |
| Reels qua recommend chịu tải cao hơn | Có | k6: mixed 20 → 50 req/s, for_you 20 → 40 req/s |
| Không đổi API, sự kiện, schema | Có | Chỉ đổi một hằng số của ranker |

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --affected --concurrency=2` (sau khi merge `origin/develop`): 49/49 task đạt; core-api 206 file / 3.238 test pass (4 test skip có sẵn).
- `vitest run src/modules/discovery/recommend`: 31 file / 267 test pass.

## Cách kiểm lại

1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/discovery/recommend`
2. Trên staging sau deploy: đăng nhập, mở Reels → Dành cho bạn, trang đầu vẫn có bài lý do "Vì bạn đang tìm hiểu …"; log `recommend.served` có `source: taste` / `hot`.
3. Muốn đo lại: bắn `/api/recommendations/reels?mode=mixed` bằng bộ k6 của TF120 (`tools/bench/feed-load`), đổi endpoint và thêm token đăng nhập.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không. Chỉ sửa trong `discovery`.
- Ghi chú cho Phong (TF120): đo cũng thấy job `recommend_build` chặn event loop tới 2,6 s mỗi lượt khi chạy chung tiến trình với API (`APP_ROLE=all`); sẽ sửa ở task riêng.
