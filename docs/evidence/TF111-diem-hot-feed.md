# TF111 — Điểm Hot của feed, giai đoạn 1

- Jira: SCRUM-176 · Nhánh: `phong/TF111-completeness-content` (PR #274, đã merge), `phong/TF111-tin-hieu-hot`, `phong/TF111-diem-hot` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-20

## Đã làm
- **Độ hoàn thiện bài** (PR #274): chép `completeness.ts` của discovery (TF108) sang `content/feed/domain`, export qua `content/index.ts`, để feed tính điểm mà không import vào discovery.
- **Lưu tín hiệu** (`phong/TF111-tin-hieu-hot`):
  - Bảng `content.trend_signals` giữ lượt xem đủ và lượt bấm đặt kèm thời điểm, mỗi người một dòng cho mỗi loại trên mỗi bài.
  - Consumer group `core-feed-trend` đọc `stream:app-events`. Lượt bấm đặt của khách bị bỏ, vì docs/10 chỉ tính lượt xem của khách.
  - Job dọn tín hiệu quá 30 ngày, chạy mỗi 24 giờ.
- **Tính và đọc điểm** (`phong/TF111-diem-hot`):
  - Bảng `content.trend_scores`. Job chạy mỗi 5 phút ở worker, và chạy một lần ngay khi worker khởi động. Mỗi lượt chấm lại toàn bộ bài video đăng trong 30 ngày và thay cả bảng trong một transaction.
  - Công thức theo docs/10: `log10(1 + Σ trọng_số × 0,5^(tuổi / 48h)) × (0,5 + 0,5 × completeness)`, chuẩn hoá theo p99 về [0, 1].
  - Trọng số: xem đủ 1, thích 1, bình luận 2, lưu 3, chia sẻ 4 (chưa có dữ liệu), bấm đặt 5. Khách xem nhân 0,5.
  - Không tính tương tác của chính tác giả. Mỗi người chỉ tính một bình luận trên mỗi bài, và chỉ tính bình luận đang hiện công khai.
  - Tab "Đang hot" (`/v1/feed?tab=hot`) đọc từ `trend_scores`, thay cho bộ đếm và cửa sổ tạm 7 ngày. Bài bị ẩn vẫn biến mất ngay ở lần đọc kế tiếp.
  - `FeedFacade.listTopHot({ postType: 'video', limit, cursor })` và `FeedFacade.getHotScores(postIds)` cho discovery dùng. `getHotIds` trả thêm `score` cho từng bài, không đổi chữ ký.
  - Cursor tab hot nhận điểm trong [0, 1] thay vì số nguyên.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Điểm có lượt lưu, lượt xem, lượt bấm đặt | Đạt | `feed.int.spec.ts`: "xếp theo trọng số docs/10…" |
| Điểm giảm dần theo thời gian (bán rã 48 giờ) | Đạt | `hot-trend.spec.ts` (decayFactor); `feed.int.spec.ts`: "tín hiệu cách đây 48 giờ còn một nửa" |
| Nhân độ hoàn thiện bài | Đạt | `feed.int.spec.ts`: "bài hoàn thiện hơn được điểm cao hơn" |
| Chống đẩy ảo: một lần mỗi người, khách nhân 0,5, bỏ tương tác của tác giả | Đạt | `drizzle-trend-signal.store.int.spec.ts`; `feed.int.spec.ts`: "khách xem tính một nửa…" |
| Export điểm 0–1: `getHotScores`, `listTopHot` | Đạt | `feed.facade.spec.ts`; `feed.int.spec.ts`: "getHotIds… kèm điểm", "getScores…" |
| Tab hot của mobile dùng điểm mới | Đạt | `feed.int.spec.ts` khối "tab hot (điểm trend_scores, TF111)"; `feed.e2e.spec.ts` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 tác vụ; core-api 3104 test đạt, 4 bỏ qua (có sẵn từ trước); lint 0 lỗi, không có cảnh báo mới.
- Test integration content trên Postgres (`vitest -c vitest.int.config.ts src/modules/content`): feed 29/29 đạt. Một lượt chạy cả thư mục có test moderation "20 lệnh ẩn cùng lúc…" lỗi; chạy riêng 3 lần đều đạt 79/79. Test này chạy song song nên phụ thuộc thời gian, không liên quan TF111.
- Đo trên stack `tripflix-bench` (trạng thái B: 9.978 bài video, 90.702 cảm xúc, 6.484 bình luận, 11.048 lưu; mốc chấm 18/11 nên có 1.166 bài trong cửa sổ 30 ngày). Đo bằng SQL tương đương trong transaction có `ROLLBACK`, 3 lượt:

| Bước | Thời gian |
|---|---|
| Câu gom tín hiệu của job | 125–155 ms |
| Ghi bảng điểm (xoá và upsert 1.166 dòng) | 9–10 ms |
| Tab hot trang đầu, bản đầu lấy điểm bằng truy vấn con | 79–112 ms |
| Tab hot trang đầu, bản cuối nối `trend_scores` | khoảng 1,1 ms |
| Tab hot trang 2, bản cuối | khoảng 1,5 ms |

## Cách kiểm lại
1. `pnpm install && pnpm turbo run lint typecheck test --affected`.
2. `cd apps/core-api && npx vitest run -c vitest.int.config.ts src/modules/content/feed` (cần Docker).
3. Sau khi deploy staging: xem một reel 20 giây trên app, chờ tối đa 5 phút, rồi `select score, decayed_signal from content.trend_scores where post_id = '<id>'` phải có điểm lớn hơn 0.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- `libs/event-bus` (Dũng): thêm một dòng `'core-feed-trend'` vào `CONSUMER_GROUPS`.
- `content/db` (chung Phong, Thành, Trang): thêm 2 migration chỉ tạo bảng mới `trend_signals`, `trend_scores`; không sửa bảng cũ.
- Discovery (Duy): chưa đổi gì. Duy chuyển chip Thịnh hành và ô hot của `mode=mixed` sang `listTopHot`/`getHotScores`, và đổi import `completeness` sang `modules/content`.
- Tab "Đang hot" trên mobile sẽ xếp khác web "Thịnh hành" cho tới khi discovery chuyển sang điểm của feed (Phong đã chốt).
