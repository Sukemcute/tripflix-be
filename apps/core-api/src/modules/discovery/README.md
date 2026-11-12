# Module `discovery`

- Chủ: Duy (backup Dũng)
- Database: `core`, schema `discovery`, user Postgres `tf_discovery`
- Bảng chính: `search_entities`, `search_documents`, `search_counts` (tìm kiếm); `recommend_*` (gợi ý bài, TF28)

## Phần con

- search: bài đăng, khách sạn, vé (tsvector, unaccent, pg_trgm, pgvector)
- recommend: gợi ý khách sạn trang chủ web (đã có), gợi ý bài (TF28, xem mục "Gợi ý bài viết"), gợi ý mục còn thiếu ở bước xác nhận

## Khuôn thư mục

Mỗi phần con (`search/`, `recommend/`) chia:

```
<phần-con>/
├─ api/           # controller, DTO; không mở transaction
├─ application/   # use case, @Transactional('discovery'), ghi outbox
├─ domain/        # quy tắc nghiệp vụ thuần, không import @nestjs/* hay drizzle-orm
├─ infra/         # repository Drizzle, client dịch vụ ngoài
├─ consumers/     # nghe sự kiện (chỉ chạy khi APP_ROLE là worker hoặc all)
└─ jobs/          # job định kỳ (như trên)
```

## Đã có

| Thứ | Ở đâu | Ghi chú |
|---|---|---|
| `GET /api/suggest?q=&types=` | `search/api/suggest.controller.ts` | Ô tìm web đặt chỗ: gợi ý địa điểm, khách sạn, sân bay theo tên; tối đa 8 dòng (~3 địa điểm, 4 khách sạn, 1 sân bay). Không dấu, gõ tắt (`pq`, `hcm`), gõ sai nhẹ (`nha trag`) |
| Bảng `search_entities` | `db/schema/search-entities.ts` | Bản chép dựng lại được; GIN `pg_trgm` trên `search_text` |
| Cây địa điểm v1 | `search/domain/places.ts` | 34 tỉnh + điểm đến mà commerce dùng làm `provinceSlug` (Đà Lạt ⊂ Lâm Đồng…). Chưa có xã/phường, toạ độ |
| Dựng lại chỉ mục | `search/jobs/rebuild-suggest-index.job.ts` | Mỗi lần khởi động khi `APP_ROLE` là `worker` hoặc `all` |
| `GET /api/stays` | `search/api/stays.controller.ts` | Trang kết quả web OTA: khách sạn còn phòng ở một nơi cho ngày đã chọn, giá thật từ commerce; lọc sao, giá; sắp giá hoặc sao |
| `GET /api/recommendations/home` | `recommend/api/home-recommendations.controller.ts` | Khối "Gợi ý dành cho bạn" trang chủ web, mỗi thẻ kèm lý do (TF12) |
| `POST /api/search` | `search/api/explore.controller.ts` | Tìm khám phá của app: một ô tìm, kết quả chia vùng (Ở đâu, Lộ trình, Bài viết, Video). Xem mục 6 (TF11) |
| Bảng `search_documents`, `search_counts` | `db/schema/` | Chỉ mục tìm khám phá + mọi bộ đếm; job `search/jobs/rebuild-explore-index.job.ts` dựng lại mỗi 10 phút |
| Gỡ bài ẩn khỏi chỉ mục + nạp tương tác cho gợi ý | `consumers/discovery-events.consumer.ts` | Consumer **duy nhất** của group `core-discovery` trên `stream:core.{content,commerce,access,discovery}`: mỗi sự kiện qua search (bài bị ẩn/xoá rời `search_documents` trong vài giây, TF33) rồi recommend (dòng thô `recommend_interactions`, TF28) |
| `GET /api/recommendations/posts` | `recommend/api/post-recommendations.controller.ts` | Gợi ý bài `for_you`/`trending`, đăng nhập tuỳ chọn (TF28) |
| Bảng `recommend_*` | `db/schema/recommend.ts` | Bảng thô `recommend_interactions`, metadata bài, điểm bài, đặc trưng người, `recommend_algos`, `recommend_job_state` |
| Job đặc trưng gợi ý | `recommend/jobs/build-features.job.ts` | Lúc khởi động và mỗi 10 phút; dọn hạn lưu bảng thô mỗi 24 giờ (`purge-interactions.job.ts`) |

## Giao tiếp

- Gọi: `CommerceFacade.listCatalog` (dựng chỉ mục gợi ý; danh sách khách sạn của `/stays`; danh mục cho gợi ý trang chủ) và `CommerceFacade.checkAvailability` (`/stays`); `ContentFacade.listPosts` (dựng chỉ mục tìm khám phá) và `ContentFacade.getVisiblePosts` (`/search`, bỏ bài đã ẩn). `DiscoveryModule` import `CommerceModule`, `ContentModule`.
- Nghe sự kiện: một consumer `DiscoveryEventsConsumer`, group `core-discovery` (thêm consumer thứ hai cùng group thì mỗi sự kiện chỉ tới một bên). Recommend (TF28): đổi sự kiện thành dòng thô theo `recommend/domain/ingest/to-raw-rows.ts`. Search (TF33, 09/11) nghe `content.post.moderated`, `content.post.deleted`, `content.post.updated` trên `stream:core.content`. Không đọc action trong payload mà gọi `ExploreUseCases.dropHidden([postId])`: hỏi lại `getVisiblePosts`, bài không còn hiện thì xoá `post:<id>` khỏi `search_documents`. Không sửa `search_counts`, không thêm lại bài khi restore (job 10 phút lo). Job dựng lại chỉ mục cũng gọi `dropHidden` cho mọi bài ngay sau khi commit, để bài bị ẩn trong lúc dựng không bị ghi lại.
- Ngoài việc gỡ bài ẩn, search không bao giờ chờ sự kiện: request chỉ đọc bảng của discovery hoặc gọi hàm module khác trong tiến trình. Bản chép được làm mới bằng job nền (xem bảng 1, 3, 4). **Không nghe `commerce.ari.updated`**: discovery không giữ giá hay còn phòng thật (`/stays` gọi thẳng commerce), nên không có gì để cập nhật. Danh mục khách sạn v1 là seed, nạp lại lúc worker khởi động hoặc qua lệnh reindex. Cần cập nhật ngay thì thêm `commerce.catalog.updated { productIds }` (chỉ mang id, discovery tự gọi `listCatalog`).
- Cho module khác: không export hàm nào (content, commerce bị discovery gọi nên không được gọi ngược).

## Luồng đã chốt (Duy, 05/11)

Mọi lời gọi sang module khác là gọi hàm trong tiến trình qua `index.ts`, không qua mạng. Discovery **không bao giờ** đọc bảng của module khác.

Có hai nhóm:
- **Web đặt chỗ (kiểu Traveloka):** `/suggest` là ô tìm duy nhất. `/stays` là lọc và sắp xếp trên tập khách sạn có hạn của một nơi, không phải search.
- **App (kiểu TikTok/Netflix):** `/search/*` tìm trên bản sao của discovery.

### 1. `GET /api/suggest` — web, **đã có**

| | |
|---|---|
| Vào | `q` (2–100 ký tự), `types` (CSV `place,hotel,airport`, bỏ trống = cả ba) |
| Ra | `{ items: [{ id: '<type>:<refId>', type, refId, name, subtitle, placeId }] }`, tối đa 8 dòng (~3 địa điểm, 4 khách sạn, 1 sân bay); không khớp thì `items: []` |
| Mỗi request | Chỉ đọc `discovery.search_entities` (pg_trgm). Không gọi module khác |
| Nạp dữ liệu | Địa điểm, sân bay: hằng trong `search/domain/`. Khách sạn: `commerce.listCatalog({ type: 'hotel', cursor, limit: 200 })` lặp theo `nextCursor`, chỉ lấy `id`, `name`, `province`, `stars` |
| Khi nào nạp | Lúc worker khởi động: xoá hết rồi ghi lại trong một transaction (vài trăm dòng). Sau thêm consumer sự kiện và lệnh reindex ở `/admin` |

Chọn địa điểm thì web gọi `/stays?placeId=<refId>`. Chọn khách sạn thì web mở trang chi tiết của commerce.

### 2. `GET /api/stays` — web, **đã có**

| | |
|---|---|
| Vào | `placeId`, `checkIn`, `checkOut`, `adults`, `rooms?`, `minStars?`, `priceMin?`, `priceMax?` (giá một đêm một phòng), `sort=price|stars`, `cursor?`, `limit?` (1–50, mặc định 20) |
| Ra | `{ items: [{ hotelId, name, stars, thumbnail, province, unitPrice, totalPrice }], total, nextCursor }`. Nơi lạ, ngày sai (commerce trả `invalid_query`) thì 400. Chỉ khách sạn còn phòng cho ngày đã chọn |
| Luồng | 1. Đổi `placeId` thành danh sách `provinceSlug` theo cây địa điểm: chọn tỉnh thì lấy tỉnh đó cùng các điểm đến con (Lâm Đồng → `lam-dong`, `da-lat`); chọn điểm đến thì chỉ lấy điểm đến đó.<br>2. `commerce.listCatalog({ type: 'hotel', provinceSlug })` cho từng slug: lấy danh sách khách sạn của nơi đó (vài chục đến vài trăm).<br>3. `commerce.checkAvailability({ productIds, checkIn, checkOut, adults, rooms })` theo lô ≤ 100 id: lấy còn phòng và giá thật.<br>4. Bỏ khách sạn hết phòng, lọc, sắp xếp, phân trang |
| Không làm | Không giữ bản sao khách sạn trong discovery cho luồng này: tập dữ liệu có hạn theo nơi, gọi thẳng commerce thì giá và phòng luôn mới. Không trả `remaining` ra API |

### 3. `POST /api/search/stays` — app, chưa code

| | |
|---|---|
| Vào | `{ q, filters?: { placeId, priceMaxPerNight, types, adults } }` |
| Ra | Thẻ khách sạn: `hotelId`, `name`, `province`, `thumbnail`, `priceFrom` ("từ X/đêm") |
| Luồng | Tìm gần đúng (pg_trgm + full-text) trên bản sao khách sạn của discovery. `filters` có thì lọc cứng. **Không bắt buộc hiểu ý câu**, không gọi commerce khi tìm. Còn phòng và giá thật do commerce kiểm khi người dùng mở chi tiết và chọn ngày |
| Nạp dữ liệu | Cùng job với `/suggest`: `listCatalog` trả sẵn `priceFrom` (giá thấp nhất 30 ngày tới) và `thumbnail` |

### 4. `POST /api/search/posts` — app (F4), chưa code, thiếu đầu vào

| | |
|---|---|
| Vào | `{ q, filters? }` |
| Ra | Thẻ bài đăng của các bài còn hiện |
| Luồng | Hiểu câu bằng luật và từ điển → tìm trong bản sao bài đăng (full-text) → top 20 id → `content.getVisiblePosts(ids)` (đã có trên `develop`) để bỏ bài đã ẩn |
| Nạp dữ liệu | Job nền mỗi 1–2 phút gọi `content.listPosts({ updatedAfter, cursor })` lấy bài mới hoặc vừa sửa → upsert bản chép. Không dùng sự kiện ở v1; bài bị ẩn không lọt ra vì lúc tìm vẫn lọc bằng `getVisiblePosts`. Bài mới hiện trong kết quả chậm tối đa một chu kỳ job |
| Còn thiếu từ `content` | Hàm `listPosts({ updatedAfter, cursor })` trên `ContentFacade`. Cần thống nhất với Thành, Phong |

### 5. `GET /api/recommendations/home` — web, **đã có** (TF12)

| | |
|---|---|
| Vào | `recentPlaceIds?` (CSV, mới nhất trước, tối đa 10; nơi lạ bị bỏ qua), `limit?` (1–20, mặc định 8). Web tự nhớ các `refId` địa điểm người dùng vừa chọn ở `/suggest` trong trình duyệt; server không lưu gì |
| Ra | `{ items: [{ hotelId, name, thumbnail, stars, brand, province, priceFrom, reason: { code, text } }] }`. `code`: `recent_place` ("Vì bạn vừa tìm Đà Lạt") hoặc `good_deal` ("Rẻ hơn 37% so với giá trung bình khách sạn 5 sao"). Có thể rỗng |
| Luồng | 1. Danh mục khách sạn: `commerce.listCatalog({ type: 'hotel', days: 30 })` đọc hết theo con trỏ, giữ trong bộ nhớ 10 phút; bỏ khách sạn không có giá.<br>2. Tối đa 3 nơi vừa tìm, mỗi nơi 2 khách sạn (tỉnh gồm điểm đến con), nhiều sao rồi rẻ trước.<br>3. Phần còn lại: khách sạn rẻ hơn trung vị cùng hạng sao ≥ 10% (hạng có ≥ 3 khách sạn), rẻ nhiều nhất trước; mỗi tỉnh một, mỗi chuỗi (`brand`) một, `brand` null là độc lập nên không giới hạn |
| Không làm | Chưa có "xu hướng", "người giống bạn": chưa có lượt xem, lượt đặt (chờ analytics, TF28). Lý do chỉ ghi điều đúng sự thật tính được từ danh mục |

### 6. `POST /api/search` — app, **đã có** (TF11)

| | |
|---|---|
| Vào | `{ q, loc?: { lat, lng } }`. `loc` chỉ dùng khi câu không nói nơi |
| Ra | `{ understood, nearUser, sections: [{ kind, label, total, items }], suggest, dropped }`. `kind`: stay, plan, post, video (food, cafe, see rỗng tới khi có nguồn POI). Item: `id`, `kind`, `refId`, `title`, `subtitle`, `thumbnail`, `reason`, `priceFrom`, `days`, `location` |
| Luồng | 1. Hiểu câu (`search/domain/explore/query.ts`): nơi, ý muốn, ngân sách, số ngày, tên riêng, cụm dính, sửa lỗi gõ — đọc bộ đếm cần cho câu từ `search_counts`.<br>2. Mỗi nhánh (song song) lấy ứng viên bằng SQL (`terms && …`, tên đường, tầm, số ngày, khung toạ độ quanh nơi) rồi chấm BM25, độ phủ, luật dấu, chất lượng, độ gần bằng TS (`rank.ts`).<br>3. `content.getVisiblePosts` bỏ bài vừa ẩn |
| Nạp dữ liệu | Job mỗi 10 phút (worker): đọc hết `listCatalog` + `listPosts`, dựng chỉ mục bằng TS, một transaction xoá rồi ghi lại (advisory lock), sau commit gỡ bài vừa bị ẩn (`dropHidden`). Dựng lại toàn bộ vì `listPosts` không báo bài bị ẩn; ~230 mục mất ~2 s. Bài bị ẩn/xoá rời chỉ mục trong vài giây nhờ consumer (TF33), nên `total` chỉ dư bài ẩn trong khoảng đó |
| Đối chiếu | Port từ prototype Python `experiments/natural-search` (ngoài repo). `explore.parity.spec.ts` chạy 134 câu của prototype, kết quả trùng hoàn toàn (đặt `EXPLORE_PARITY_DIR`) |
| Từ điển | `search/domain/explore/lexicon-rows.ts`. Thêm cách viết mới = thêm dòng; chỉ mục dựng lại ở chu kỳ job kế tiếp |

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate discovery`. Không sửa migration đã merge.

## Gợi ý bài viết (TF28)

Thiết kế: root `docs/proposals/recommend-offline-architecture.md`. Ba phần, nối bằng bảng:

1. **Nạp** (`consumers/discovery-events.consumer.ts` → `recommend/domain/ingest/to-raw-rows.ts`): sự kiện → 0..n dòng `recommend_interactions`. `ref_id` quyết định ghi đè (cảm xúc theo bài) hay thêm mới (`eventId`, như chia sẻ, tìm kiếm). Upsert chỉ ghi đè khi `occurred_at` mới hơn: giao lại không ghi đôi, sự kiện cũ không đè. Không lưu nội dung bình luận, câu tìm, tên, liên hệ.
2. **Tính đặc trưng** (`recommend/application/build-features.use-cases.ts`, mỗi 10 phút, advisory lock): đồng bộ `recommend_posts` từ `content.listPosts` (`placeId` = tỉnh khách sạn gắn bài, không thì nơi trong `destinationName` + tiêu đề), chạy mọi post builder trên **một lô gồm mọi bài**, user builder theo lô 200. Builder lỗi giữ dữ liệu cũ, ghi `recommend_job_state.last_error`.
3. **Phục vụ** (`recommend/application/post-recommendations.use-cases.ts`): bộ ba thuật toán từ `recommend_algos` (cache 60 giây) → ứng viên `hot` ≤ 150 + `fresh` (48 giờ) ≤ 50 + ~5% `explore` → bỏ bài đã tương tác → ranker → đẩy bài đã gợi ý ở phiên trước xuống cuối (Redis ZSET 48 giờ, ≤ 100 id, "phiên trước" = hơn 30 phút trước trang đầu) → `getVisiblePosts`. Phân trang bằng offset trong cursor cho mọi người, nên tải lại cùng trang ra cùng kết quả. Không đọc bảng thô, không ghi Postgres. Redis lỗi vẫn trả.

**Cắm thuật toán:** hàm thuần trong `recommend/domain/` theo `contracts.ts` (JSON camelCase), đăng ký ở `registry.ts`. Builder v0: `hot@v0`, `tag_affinity@v0`, `none@v0`; ranker `tag_affinity_v0`, `popular_v0`. Đổi thuật toán không cần deploy:

```sql
UPDATE discovery.recommend_algos SET ranker = 'popular_v0', updated_at = now() WHERE name = 'for_you';
```

Bộ ba mà ranker không khai báo đọc được (`ranker.accepts`) bị từ chối: endpoint log `error` và dùng `trending`.

**Theo dõi:** `recommend_job_state` (`last_run_at`, `last_error` theo từng builder), log `recommend.served` (`mode, algo, source, postId`), `XINFO GROUPS stream:core.content` (lag, pending của `core-discovery`).
