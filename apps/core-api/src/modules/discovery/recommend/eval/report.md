# Bộ đo offline for-you (TF28)

Sinh tự động bởi `recommend-eval.spec.ts`, không sửa tay. Thiết kế: thiết kế v1 mục 4 (tài liệu riêng của Duy).

- "Hôm nay" của bộ đo: 2026-11-13T00:00:00.000Z. 243 bài trong `fixtures/posts-2026-11-18.json`.
- Danh sách đã qua feed-policy, chưa trộn ô khám phá (ô này ngẫu nhiên theo thiết kế).
- `đúng nơi@10`: tỉ lệ top 10 ở nơi persona đang nhắm / đã đặt / thật sự thích. `nơi vừa đi@10`: tỉ lệ top 10 ở nơi vừa về.
- `KS khác@10`: số bài trong top 10 gắn khách sạn khác ở nơi đã đặt.

Dump lại fixture (DB local, xem `fixtures/dump-posts.sql`):

```
docker exec -i tripflix-postgres-1 psql -U postgres -d core -A -t < fixtures/dump-posts.sql
```

### Ngăn của bài (post_profile@v1)

243 bài: 239 có nơi, 4 không có nơi; 30 không có ngăn trải nghiệm nào.

| Ngăn | Số bài |
|---|---|
| `cost:binh_dan` | 66 |
| `cost:cao_cap` | 42 |
| `cost:trung` | 13 |
| `exp:an_uong` | 88 |
| `exp:bien` | 24 |
| `exp:cafe` | 45 |
| `exp:nghi_duong` | 18 |
| `exp:nui` | 38 |
| `exp:song_ao` | 49 |
| `exp:van_hoa` | 25 |
| `exp:ve_dem` | 18 |
| `exp:vui_choi` | 16 |
| `len:ngan` | 52 |
| `len:vua` | 17 |
| `with:cap_doi` | 13 |
| `with:gia_dinh` | 13 |
| `with:mot_minh` | 10 |

### v0 (tag_affinity_v0, 150 hot + 50 mới)

| Persona | Giai đoạn | Mục tiêu | hit@20 | đúng nơi@10 | nơi vừa đi@10 | số nơi@20 | chuỗi cùng nơi@20 | KS khác@10 | Lý do top 10 |
|---|---|---|---|---|---|---|---|---|---|
| `mo-bien-capdoi` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 0 | – | – | 6 | 2 | – | Vì bạn thích chủ đề #bien · Vì bạn quan tâm Vũng Tàu · Vì bạn quan tâm Hội An |
| `mo-nui-phuot` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 1 | – | – | 7 | 3 | – | Vì bạn quan tâm Ninh Bình · Vì bạn thích chủ đề #xuhuong · Vì bạn thích chủ đề #camping |
| `mo-an-uong` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 1 | – | – | 9 | 1 | – | Vì bạn quan tâm Đà Nẵng · Vì bạn quan tâm Sài Gòn · Vì bạn quan tâm Hà Nội |
| `mo-van-hoa` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 0 | – | – | 7 | 7 | – | Vì bạn quan tâm Nha Trang · Vì bạn quan tâm Đà Nẵng · Vì bạn quan tâm Quy Nhơn |
| `ca-that-18-11` | Lên kế hoạch | đúng nơi ≥ 0,4 | – | 0,70 | – | 5 | 3 | – | Vì bạn thích chủ đề #nhatrang · Vì bạn thích chủ đề #dalat · Vì bạn thích chủ đề #fyp |
| `kh-dalat-sang-nhatrang` | Lên kế hoạch | đúng nơi ≥ 0,4 | – | 0,70 | – | 7 | 4 | – | Vì bạn quan tâm Nha Trang · Vì bạn quan tâm Đà Lạt |
| `kh-moi-phuquoc` | Lên kế hoạch | đúng nơi ≥ 0,4 | – | 0,20 | – | 5 | 6 | – | Vì bạn quan tâm Phú Quốc · Bài viết thịnh hành trên TripFlix |
| `sap-di-nhatrang` | Sắp đi | đúng nơi ≥ 0,4, KS khác ≤ 1 | – | 0,70 | – | 8 | 6 | 0 | Vì bạn quan tâm Nha Trang · Vì bạn thích chủ đề #xuhuong · Vì bạn thích chủ đề #checkin |
| `dang-di-dalat` | Đang đi | đúng nơi ≥ 0,4 | – | 0,60 | – | 7 | 2 | 0 | Vì bạn quan tâm Đà Lạt · Vì bạn thích chủ đề #cafe · Vì bạn thích chủ đề #fyp |
| `vua-ve-phuquoc` | Vừa về | nơi vừa đi ≤ 0,2 | – | – | 0,40 | 9 | 2 | – | Vì bạn quan tâm Phú Quốc · Vì bạn thích chủ đề #xuhuong · Vì bạn thích chủ đề #bien |
| `mo-xem-reels-bien` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 1 | – | – | 8 | 2 | – | Vì bạn quan tâm Huế · Vì bạn thích chủ đề #bien · Vì bạn quan tâm Nha Trang |
| `kh-bam-dat-reels-danang` | Lên kế hoạch | đúng nơi ≥ 0,4 | – | 0,10 | – | 5 | 3 | – | Vì bạn quan tâm Đà Lạt · Vì bạn quan tâm Ninh Bình · Vì bạn quan tâm Đà Nẵng |
| `khach` | Khách | như trending | – | – | – | 6 | 5 | – | Bài viết thịnh hành trên TripFlix |

### v1 (trip_v1, đọc toàn bộ bài)

| Persona | Giai đoạn | Mục tiêu | hit@20 | đúng nơi@10 | nơi vừa đi@10 | số nơi@20 | chuỗi cùng nơi@20 | KS khác@10 | Lý do top 10 |
|---|---|---|---|---|---|---|---|---|---|
| `mo-bien-capdoi` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 1 | – | – | 12 | 2 | – | Vì bạn hay xem bài về biển đảo · Vì bạn quan tâm Vũng Tàu · Vì bạn hay xem bài về ngắm cảnh, sống ảo |
| `mo-nui-phuot` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 1 | – | – | 10 | 2 | – | Vì bạn hay xem bài về núi, thiên nhiên · Vì bạn quan tâm Ninh Bình · Vì bạn hay xem bài về ngắm cảnh, sống ảo |
| `mo-an-uong` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 0 | – | – | 11 | 2 | – | Vì bạn hay xem bài về ăn uống · Vì bạn hay xem bài về cà phê |
| `mo-van-hoa` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 1 | – | – | 12 | 2 | – | Vì bạn hay xem bài về văn hoá, di tích · Vì bạn quan tâm Nha Trang |
| `ca-that-18-11` | Lên kế hoạch | đúng nơi ≥ 0,4 | – | 0,70 | – | 5 | 4 | – | Vì bạn đang tìm hiểu Đà Lạt · Vì bạn đang tìm hiểu Nha Trang · Vì bạn đang tìm hiểu Hà Nội |
| `kh-dalat-sang-nhatrang` | Lên kế hoạch | đúng nơi ≥ 0,4 | – | 0,40 | – | 10 | 4 | – | Vì bạn đang tìm hiểu Nha Trang · Gần Nha Trang mà bạn đang tìm hiểu · Vì bạn hay xem bài về núi, thiên nhiên |
| `kh-moi-phuquoc` | Lên kế hoạch | đúng nơi ≥ 0,4 | – | 0,40 | – | 8 | 4 | – | Vì bạn đang tìm hiểu Phú Quốc · Vì bạn đang tìm hiểu các nơi có nghỉ dưỡng · Vì bạn đang tìm hiểu các nơi có biển đảo |
| `sap-di-nhatrang` | Sắp đi | đúng nơi ≥ 0,4, KS khác ≤ 1 | – | 0,40 | – | 12 | 4 | 0 | Cho chuyến Nha Trang 16/11 của bạn · Vì bạn hay xem bài về ngắm cảnh, sống ảo · Vì bạn hay xem bài về biển đảo |
| `dang-di-dalat` | Đang đi | đúng nơi ≥ 0,4 | – | 0,40 | – | 7 | 4 | 0 | Cho chuyến Đà Lạt 12/11 của bạn · Vì bạn hay xem bài về khu vui chơi, mua sắm · Vì bạn hay xem bài về cà phê |
| `vua-ve-phuquoc` | Vừa về | nơi vừa đi ≤ 0,2 | – | – | 0 | 13 | 2 | – | Bạn vừa đi Phú Quốc, thử thêm bài về biển đảo |
| `mo-xem-reels-bien` | Mơ | số nơi ≥ 4, chuỗi ≤ 3 | 1 | – | – | 10 | 2 | – | Vì bạn hay xem bài về biển đảo · Vì bạn hay xem bài về cà phê · Vì bạn quan tâm Nha Trang |
| `kh-bam-dat-reels-danang` | Lên kế hoạch | đúng nơi ≥ 0,4 | – | 0,40 | – | 9 | 4 | – | Vì bạn đang tìm hiểu Đà Nẵng · Vì bạn hay xem bài về ăn uống · Vì bạn hay xem bài về cà phê |
| `khach` | Khách | như trending | – | – | – | 6 | 5 | – | Bài viết thịnh hành trên TripFlix |
