# TF28 — Khung gợi ý bài viết (PR D: nạp sự kiện → tính đặc trưng → phục vụ)

- Notion: chưa cung cấp link task · Nhánh: `duy/TF28-khung-recommend` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-12

## Đã làm

- Domain v0 trong `discovery/recommend/domain`: builder `hot@v0`, `tag_affinity@v0`, `none@v0`; ranker `tag_affinity_v0`, `popular_v0`; registry kiểm bộ ba thuật toán; chọn ứng viên (hot, mới, khám phá ~5% theo hash cố định). Hàm thuần, chưa tinh chỉnh công thức.
- Đổi sự kiện thành dòng tương tác thô (`toRawRows`), upsert idempotent: giao lại không ghi đôi, sự kiện cũ không đè sự kiện mới.
- 6 bảng `recommend_*` + migration seed hai chế độ `for_you`, `trending`.
- Gộp consumer search và gợi ý thành một consumer duy nhất của group `core-discovery` (4 stream), vì hai consumer cùng group sẽ chia nhau sự kiện.
- Job 10 phút tính đặc trưng (advisory lock, builder lỗi giữ dữ liệu cũ và ghi `lastError`); job 24 giờ dọn hạn lưu bảng thô theo lô 5.000.
- Endpoint `GET /api/recommendations/posts` (đăng nhập tuỳ chọn): khách nhận `trending`, chống lặp bằng Redis 48 giờ, bộ ba sai thì lùi về `trending`, lọc bài đã ẩn bằng `content.getVisiblePosts`.
- Search phát `discovery.search.performed` / `discovery.stays.searched` khi đã đăng nhập và ở trang đầu (không chờ, lỗi không ảnh hưởng search).
- Sửa theo review D4: `occurred_at <= now`, lọc `post_type` trên `recommend_post_scores`, `replacePosts` 0 bài thì không xoá và bỏ lượt.
- Sửa lỗi tìm thấy khi demo: kho khám phá rỗng làm trang thiếu một bài và mất cursor trang sau. Có test tái hiện.

## Đối chiếu "Xong khi"

| Tiêu chí (từ prompt PR D) | Đạt | Bằng chứng |
|---|---|---|
| Tương tác → dòng thô ≤ 1 giây | Có | Demo: 3 cảm xúc + 1 tìm → đủ 4 dòng sau 865 ms |
| Sau một chu kỳ job, `for_you` đưa bài Đà Lạt lên đầu | Có | Bài "Săn mây Đà Lạt" từ hạng 4 (`trending`) lên hạng 1 (`matches_place`) |
| 2 trang liên tiếp không trùng | Có | Demo: trùng 0; test `2 trang liên tiếp không trùng bài` |
| Khách không token nhận `trending` | Có | Demo + test `khách: nhận trending...` |
| Đổi `for_you.ranker='popular_v0'` có hiệu lực ≤ 1 phút | Có | Demo: đổi sau 54 giây |
| Bộ ba sai bị từ chối, có log | Có | Log `recommend_algos có bộ ba không hợp lệ, dùng trending` (`user_builder không có: khong_co@v9`) |
| Giao lại sự kiện không ghi đôi | Có | `discovery-events.consumer.int.spec.ts` |

## Kết quả kiểm tra

- `pnpm --filter @tripflix/core-api test:int`: 16 file, 136 test pass.
- Unit discovery (`vitest run src/modules/discovery`): 139 pass, 1 skip có sẵn (so khớp Python).
- `pnpm turbo run lint typecheck test --affected`: xem PR.

Số đo (stack local, 51 bài):

| Đo | Kết quả |
|---|---|
| Upsert một dòng thô (500 lần) | p50 1,33 ms · p95 1,85 ms |
| Một chu kỳ job tính đặc trưng | 510–586 ms |
| Endpoint, 200 request mỗi loại | khách p95 10,1 ms · đăng nhập p95 11,2 ms |

## Cách kiểm lại

1. `pnpm stack:be`, chờ core-api healthy.
2. Đăng nhập `member@tripflix.local` trên Swagger `http://localhost:3000/docs`, thả cảm xúc 1–2 bài Đà Lạt, tìm "Đà Lạt".
3. `docker restart tripflix-core-api-1` (job chạy lúc khởi động) hoặc chờ 10 phút.
4. Gọi `GET /api/recommendations/posts`: bài Đà Lạt chưa tương tác lên đầu với lý do `matches_place`. Bỏ token thì nhận `trending`.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không sửa code module khác. Chỉ gọi facade có sẵn: `content.listPosts`, `content.getVisiblePosts`, `commerce.listCatalog`.
- `contracts/openapi/core-api.json` sinh lại: thêm endpoint mới, các route search/stays thêm `security` tuỳ chọn. Chỉ thêm, không đổi hợp đồng cũ.
