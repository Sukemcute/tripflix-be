# TF107 — Nạp dữ liệu mô phỏng gợi ý (bộ sinh v2 của Duy) vào hệ thống

- Jira: SCRUM-174 (TF107) · Nhánh: `phong/TF107-nap-du-lieu-mo-phong-goi-y` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- Lý do: Duy cần chạy thuật toán gợi ý và Bảo cần test AI trên dữ liệu có quy mô. Dữ liệu là bộ mô phỏng seed 42 của Duy: 2.000 người, 41.769 bài, 123.896 sự kiện trong 120 ngày.
- CLI mới `apps/core-api/src/cli/sim-recommend.ts` có 5 lệnh:
  - `plan`: chỉ đếm, không ghi.
  - `seed-state`: ghi người dùng, bài, theo dõi, cảm xúc, lưu, bình luận.
  - `replay`: phát thử vài sự kiện mỗi loại vào stream thật.
  - `ingest`: nạp hàng loạt bằng đúng `RecommendIngestUseCases` của discovery.
  - `remove`: xoá đúng dữ liệu mô phỏng, là đường lui trước khi lên staging. Thiếu `--yes` thì chỉ đếm từng bảng.
- Phạm vi của `remove`:
  - Hai lớp chặn: ID phải là uuid v5 tính lại từ bộ dữ liệu; người dùng phải có email `@sim.tripflix.local`, bài phải do người dùng mô phỏng đăng.
  - Xoá riêng: bảng thô, điểm bài, gu người dùng, `search_documents`, `follows`.
  - Phần còn lại tự xoá theo khi xoá bài và người dùng: cảm xúc, lưu, bình luận (kể cả của người thật trên bài mô phỏng), bộ đếm, tóm tắt, hành động kiểm duyệt, phiên đăng nhập.
  - Không đụng `moderation_cases` và `reports` (của Trang, không có khoá ngoại): chỉ đếm và báo.
- Mọi lệnh ghi phải có `--yes`, in ra DB và Redis đích trước khi ghi, và không chạy khi `NODE_ENV=production`.
- `sim-recommend/convert.ts` là hàm thuần:
  - Đổi ID mô phỏng (`usr_00001`, `post_000001`…) sang uuid v5 với namespace riêng. Chạy lại ra cùng uuid, và nhận diện được dòng mô phỏng.
  - Dời mọi mốc thời gian để ngày cuối mô phỏng gần ngày nạp. Bảng thô chỉ giữ 90/180 ngày, và điểm hot giảm theo tuổi bài.
  - Đưa payload về đúng hợp đồng thật:
    - Tìm kiếm: `placeId` thành `placeIds`.
    - Tìm phòng: `dateFrom`/`guests` thành `checkIn`/`adults`.
    - Cảm xúc bình luận: `type` thành `isLiked`.
    - Đăng bài: thêm `postType`.
  - Payload thiếu trường bắt buộc thì giữ nguyên thiếu, để hệ thống bỏ qua như với dữ liệu thật. Không tự sửa cho đẹp số.
- Không nạp phần đáp án:
  - Không nạp `posts_truth`, `exposures`.
  - Từ `users_truth` chỉ lấy id, ngày đăng ký và danh sách theo dõi; không lấy gu, chuyến đi, nơi mơ ước.
- Bài video gán xoay vòng 10 video mẫu của seed. Ghi tên nơi vào `tripAttachment.destinationName` để hệ thống tự suy `placeId` như với bài thật.
- Người dùng mô phỏng có email `usr_xxxxx@sim.tripflix.local`, mật khẩu là `SEED_PASSWORD`, để Duy và Bảo đăng nhập vai bất kỳ ai.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| `plan` báo số dòng sẽ ghi và sự kiện bị bỏ kèm lý do | Có | Mục "Kết quả chạy" |
| Số dòng khớp `plan`, chạy lại không tạo trùng | Có | `seed-state` lần 2 thêm 0 dòng ở mọi bảng |
| Phát thử mỗi loại vào stream, consumer thật ghi đúng | Có | `replay --per-type 3`: 11/11 loại có dòng thô, đủ 3/3 |
| Sau job, `GET /api/recommendations/posts` trả bài mô phỏng | Có | `usr_01158`: 7 `matches_interest`, 2 `matches_place`, 1 `explore` |
| Báo Duy các chỗ lệch | Chờ gửi | Mục "Chỗ lệch cần Duy xem" |

## Kết quả chạy (stack local riêng `tripflix-sim`, dời 6 ngày)

**`plan`**
- 108.854 sự kiện chuyển được, trong đó 1.227 bản giao lại được giữ để thử idempotent.
- 15.042 sự kiện bỏ vì hệ thống không có loại đó (xem mục dưới).
- `toRawRows` thật bỏ 99 sự kiện sai schema:
  - 66 cảm xúc thiếu `userId`.
  - 19 sự kiện đăng bài thiếu `postId`.
  - 7 lượt tìm thiếu `userId`.
  - 2 lượt tìm phòng thiếu ngày.
  - 2 cảm xúc bình luận, 2 bình luận, 1 đăng ký.

**`seed-state`** (7,5 giây)

| Bảng | Số dòng |
|---|---|
| `access.users` | 2.000 |
| `content.posts` | 41.769 |
| `content.follows` | 30.918 |
| `content.reactions` | 66.814 |
| `content.bookmarks` | 6.947 |
| `content.comments` | 2.006 |

**`ingest`** (96 giây)
- `recommend_interactions` có 104.285 dòng. Ít hơn tổng 107.513 vì upsert theo khoá, và bản giao lại không ghi đôi.

**`recommend_build`** (7,8 giây)
- 40.949 bài: 41.769 bài mô phỏng trừ 831 bài đã xoá hoặc bị ẩn, cộng 10 bài mẫu.
- 1.881 người, không builder nào lỗi.

**`remove`** (5,7 giây)
- Cách thử: nạp lại toàn bộ, chạy job `recommend_build` và `explore`, cho `member@tripflix.local` (tài khoản thật) thả cảm xúc lên một bài mô phỏng. Sau đó chạy `remove` không có `--yes`, rồi chạy có `--yes`.
- Số đếm và số xoá thật khớp ở cả 13 bảng:

| Bảng | Số dòng |
|---|---|
| `recommend_interactions` của người mô phỏng | 104.285 |
| `recommend_interactions` của người thật trên bài mô phỏng | 1 |
| `recommend_post_scores` | 40.939 |
| `recommend_posts` | 40.939 |
| `search_documents` | 40.939 |
| `follows` | 30.918 |
| `reactions` | 66.814 |
| `posts` | 41.769 |
| `users` | 2.000 |

- Lần chạy đầu, số đếm khi chưa `--yes` bị trùng ở `follows` và ở tương tác của người thật, vì một dòng khớp nhiều điều kiện. Đã sửa để mỗi dòng chỉ thuộc một nhóm.
- So số dòng không phải mô phỏng trước và sau: người dùng, bài, cảm xúc và bình luận trên bài thật, media, tương tác, tài liệu tìm kiếm đều giữ nguyên.
- Chạy lần hai không xoá gì thêm.

**Gợi ý**
- `usr_00001` đăng ký ngày 118/120, gần như chưa có tương tác: `for_you` trùng `trending`, đúng như người dùng mới.
- `usr_01158` có 229 tương tác: bài về Sài Gòn (nơi ở) và Vũng Tàu, gu `anuong`. Theo đáp án, người này mơ đi Cô Tô, Đà Nẵng, Đà Lạt, gu thật là `checkin`, `camping`. Đây là dữ liệu để Duy đánh giá thuật toán, không phải lỗi của bước nạp.

## Chỗ lệch cần Duy xem
- **`content.bookmark.updated` (7.747 sự kiện):** content không phát sự kiện này, còn discovery có kind `bookmark` (trọng số 3 và 4) nhưng không có mapper. Lưu bài hiện không vào gợi ý.
- **`commerce.product.viewed` (6.810):** hệ thống không có sự kiện xem khách sạn.
- **ID khách sạn:** khách sạn mô phỏng không khớp catalog seed (0/3.910 ID trùng), nên `order_item` không nối được với khách sạn thật.
- **Nơi chưa có trong danh sách:** Cô Tô, Hà Giang, Sa Pa có trong dữ liệu mô phỏng nhưng không có trong `PLACES`, nên bài ở các nơi này có `placeId = null`.
- **Tác dụng phụ của cách phát vào stream:** consumer kiểm duyệt (`ScreeningConsumer`, của Trang) cũng nhận bình luận và báo lỗi khi không có ai-service. Vì vậy chỉ phát thử vài sự kiện, còn nạp hàng loạt bằng `ingest`.

## Kết quả kiểm tra
- `vitest run src/cli/sim-recommend`: 9/9 test đạt (uuid v5 theo vector RFC 4122, dời thời gian, payload qua `toRawRows` thật, trạng thái cuối của content, tập ID mà `remove` được xoá).
- `pnpm turbo run lint typecheck test --affected`: 49/49 tác vụ đạt; core-api 138 file test đạt, 2 file bỏ qua có sẵn. Không có cảnh báo lint mới.
- `node tools/check-boundaries.mjs`: không có vi phạm.

## Cách kiểm lại
1. Dựng stack riêng để không đụng DB dev: `docker compose -p tripflix-sim -f deploy/compose.yaml --profile be up -d --build core-api`.
2. `pnpm --filter @tripflix/core-api build`, rồi trong `apps/core-api` đặt biến môi trường:
   - `DATABASE_URL_ACCESS`, `DATABASE_URL_CONTENT`, `DATABASE_URL_DISCOVERY`: trỏ `localhost:5432/core` với tài khoản dev trong `deploy/compose.yaml`.
   - `REDIS_URL=redis://localhost:6379`.
   - `SEED_PASSWORD`.
3. Chạy lần lượt `node dist/cli/sim-recommend.js <lệnh> --data <thư mục data của Duy>` với các lệnh:
   - `plan`
   - `seed-state --yes`
   - `replay --per-type 3 --yes`
   - `ingest --yes`
4. Đăng nhập superadmin, gọi `POST /api/v1/admin/discovery/jobs/recommend_build/run`.
5. Đăng nhập `usr_01158@sim.tripflix.local` bằng `SEED_PASSWORD`, gọi `GET /api/recommendations/posts?mode=for_you`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Code: chỉ thêm file mới trong `apps/core-api/src/cli/`, không sửa code có sẵn. CLI gọi `RecommendIngestUseCases`, `toRawRows`, `DrizzleRecommendStore` (Duy) và `Argon2PasswordHasher` (Dũng) như `seed.ts` đang làm.
- Dữ liệu: ghi vào bảng của `access` (Dũng), `content` (Phong, Thành, Trang) và `discovery` (Duy), mới chỉ trên stack local. Lên staging cần Duy đồng ý.
