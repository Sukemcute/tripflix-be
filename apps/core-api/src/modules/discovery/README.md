# Module `discovery`

- Chủ: Duy (backup Dũng)
- Database: `core`, schema `discovery`, user Postgres `tf_discovery`
- Bảng chính dự kiến: `search_documents`, `interaction_signals`, `recommendation_cache`

## Phần con

- search: bài đăng, khách sạn, vé (tsvector, unaccent, pg_trgm, pgvector)
- recommend: gợi ý bài, gợi ý mục còn thiếu ở bước xác nhận

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

## Giao tiếp

- Gọi: `CommerceFacade.listCatalog` (dựng chỉ mục gợi ý; danh sách khách sạn của `/stays`) và `CommerceFacade.checkAvailability` (`/stays`). `DiscoveryModule` import `CommerceModule`.
- Nghe sự kiện: **không, ở v1** (05/11). Search không bao giờ chờ sự kiện: request chỉ đọc bảng của discovery hoặc gọi hàm module khác trong tiến trình. Bản chép được làm mới bằng job nền (xem bảng 1, 3, 4). **Không nghe `commerce.ari.updated`**: discovery không giữ giá hay còn phòng thật (`/stays` gọi thẳng commerce), nên không có gì để cập nhật. Danh mục khách sạn v1 là seed, nạp lại lúc worker khởi động hoặc qua lệnh reindex. Cần cập nhật ngay thì thêm `commerce.catalog.updated { productIds }` (chỉ mang id, discovery tự gọi `listCatalog`).
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
| Vào | `placeId`, `checkIn`, `checkOut`, `adults`, `rooms?`, `minStars?`, `priceMin?`, `priceMax?` (giá một đêm một phòng), `sort=price|stars`, `cursor?`, `limit?` (1–50, mặc định 20) ||stars`, `cursor?` |
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

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate discovery`. Không sửa migration đã merge.
