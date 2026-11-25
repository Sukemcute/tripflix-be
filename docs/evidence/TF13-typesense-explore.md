# TF13 — Tìm khám phá trên Typesense, recommend dùng chung tầng ứng viên

- Jira: TF13 · Nhánh: `duy/TF13-typesense-explore` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-25

## Đã làm

1. **Tìm khám phá chạy được trên Typesense 29.0** (`SEARCH_BACKEND=typesense`; mặc định vẫn `postgres`, đổi lại tức thì).
   - Typesense lấy ứng viên (`multi_search`), `rank.ts` xếp lại như cũ (ACCENT_MISS, độ phủ, nơi/gần, ngân sách, số ngày, lý do, fallback).
   - Mỗi nhánh: đúng nơi + bài chưa rõ nơi trong một search (`_eval` xếp đúng nơi trước), bài nhắc nơi và lân cận 150 km tách riêng; chỉ trả `id,doc_json`.
   - Nhánh câu không nhắm tới lấy 30 ứng viên; tab Bài viết / Địa điểm (`/search/posts`, `/search/places`) luôn lấy đủ.
   - Lọc bán kính đúng cú pháp `location:(lat, lon, R km)`; search con lỗi thì ném lỗi, không trả kết quả thiếu.
2. **Đồng bộ chỉ mục không ghi đĩa thừa**.
   - Bài: theo 7 sự kiện `content.post.*` (upsert / xoá ngay).
   - Toàn bộ: đối soát mỗi 24 giờ (tối thiểu 1 giờ dù admin đặt thấp hơn), chỉ ghi mục mới/đổi theo `content_hash`; dựng collection mới + đổi alias chỉ khi chưa có chỉ mục hoặc đổi schema. Khởi động lại core-api không dựng lại.
   - Bỏ `syncMetrics` (ghi lại cả 41k bài mỗi 10 phút) và các trường like/hot trong chỉ mục.
   - `deploy/compose.yaml` (service `typesense`): healthcheck không dùng `curl` (image không có), snapshot raft 300 s, bộ đệm ghi RocksDB 64 MB (mặc định 4 MB khuếch đại ghi ~21 lần).
3. **Recommend dùng chung chỉ mục**: nguồn ứng viên theo gu (`TasteRetrieval`, nguồn `taste`).
   - Gu lấy từ `trip_profile@v1` (`answers.place`, `answers.exp`) hoặc `tag_affinity@v0`; ngưỡng theo tỉ lệ, bỏ tỉnh cha trùng.
   - Chỉ mục mang ngăn `post_profile@v1` đã tính (`place_bins`, `exp_bins`), nên lọc theo đúng cách phân loại của `trip_v1`.
   - Chỉ **bổ sung** ứng viên, vẫn đọc 5.000 bài hot (gu dài hạn chưa có tín hiệu "đang tìm hiểu / sắp đi"); không lọc bài đã xem; nguồn gu lỗi thì feed dùng hot/fresh.

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Search ngang hoặc nhanh hơn Postgres khi chịu tải | Có | 41k bài, `APP_ROLE=api`: tuần tự p50/p95 67/126 ms (Postgres 68/239); 10 luồng 40,5 rps (21,8); 30 luồng 39,1 rps, p95 1,7 s (21,5 rps, 3,4 s); 0 lỗi |
| Kết quả không tệ hơn | Có | 412/476 vùng giống Postgres top-6, 440/476 giống top-1; phần khác ở vùng phụ, đã duyệt bảng hai bên |
| 0 mục vượt ngân sách | Có | Web: "khach san da nang duoi 2tr" 66 khách sạn, 0 vượt; `explore.spec.ts`, `typo-regression.spec.ts` pass |
| Không làm đầy đĩa | Có | 44k mục: dựng toàn bộ ~0,75 GB ghi; đối soát khi không đổi 0 mục; khởi động lại không dựng |
| Recommend dùng chung chỉ mục, không tệ hơn | Có | 100 người dùng thật: nguồn gu góp 19,5% bài top-20, khớp nơi 39,2% (không nguồn gu 39,6%), p50 216 ms (204) |

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task; test 198 file / 3.194 test pass (2 file, 4 test skip sẵn); lint 0 lỗi (134 cảnh báo có sẵn).
- `pnpm turbo run lint typecheck test --affected --continue --concurrency=2`: **49/49 task đạt** (sau khi merge `origin/develop` `3d7fec9`). Chạy mặc định (song song cao) thì `video-worker` có 7 test quá 5 s do máy tải nặng; nhánh không đổi file nào của `video-worker`, chạy riêng 53/53 pass.
- Web (`tripflix-fe` develop, Next dev) với core-api Typesense: trang Cảm hứng, tab Bài viết cuộn 5 trang 100 bài không trùng, câu không dấu + ngân sách, feed "Dành cho bạn" khi đăng nhập trang 1–2 không trùng, có bài nguồn `taste`.

## Cách kiểm lại

1. `docker compose -f deploy/compose.yaml up -d postgres redis typesense`
2. core-api với `SEARCH_BACKEND=typesense` (`APP_ROLE=all` lần đầu để dựng chỉ mục; xong có thể `api`), chờ log "Đã dựng chỉ mục tìm khám phá".
3. `POST /api/search` `{"q":"resort đà nẵng"}`: vùng `stay` có resort Đà Nẵng; `POST /api/search/posts` có `nextCursor`.
4. Đăng nhập một người dùng, `GET /api/recommendations/posts?mode=for_you`: có mục `source: "taste"`.
5. Đổi `SEARCH_BACKEND=postgres` và khởi động lại: tìm kiếm chạy lại trên Postgres như trước.

## Ảnh / video

- Ảnh trang Cảm hứng và feed để trong PR.

## Ảnh hưởng tới phần của người khác

- `deploy/compose.yaml` (Phong): chỉ thêm service `typesense` và `depends_on` của core-api; `compose.server.yaml` không đổi — máy chủ vẫn chạy Postgres cho tới khi thêm Typesense.
- `apps/core-api/src/platform/env.ts`, `.env.example`: thêm `SEARCH_BACKEND`, `TYPESENSE_*` (mặc định không đổi hành vi).
- `recommend/application/post-recommendations.use-cases.ts`: thêm nguồn gu cạnh cache xếp hạng của Bảo (`d636fd1`, `aa9033c`), không đổi phần cache.
