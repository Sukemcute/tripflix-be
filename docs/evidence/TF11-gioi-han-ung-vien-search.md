# TF11 — Giới hạn số ứng viên tìm khám phá kéo từ Postgres

- Notion: — · Nhánh: `duy/TF11-gioi-han-ung-vien-search` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-20

## Đã làm
- **Lỗi:** câu không có từ tìm lẫn nơi ("nhậu", "quán nhậu", "ăn gì", "khách sạn", "lịch trình"…) có `qterms` rỗng nên rơi vào `isAll`. Khi đó `DrizzleExploreStore.candidates()` chỉ còn `WHERE vertical = ? ORDER BY ord`, không `LIMIT`, nên kéo cả bảng `search_documents` (5 nhánh) về Node. Parse JSONB và chấm điểm là việc đồng bộ, chặn event loop của core-api, nên mọi request khác (đăng nhập, feed, đặt chỗ) phải chờ.
- **Lỗi thứ hai:** `rank.ts` gom dòng bằng `[...(out.get(k) ?? []), row]`, chép lại cả mảng mỗi lượt (O(N²)). Đổi sang `push`.
- **Trần ứng viên mỗi nhánh** (`candidateLimitOf` trong `memory-source.ts`, dùng chung cho SQL và nguồn RAM):
  - Câu không từ, không nơi: `EMPTY_QUERY_LIMIT = 100`.
  - Câu có từ hoặc nơi: `CANDIDATE_LIMIT = 500`.
- Đã thử trần 100 cho mọi câu nhưng bị sót bài đúng nơi, vì `ord` là thứ tự dựng chỉ mục chứ không phải độ khớp: "khách sạn đà lạt" 83 → 46 chỗ ở (đổi 3/6 kết quả đầu), "lịch trình phú quốc" 86 → 2. Vì vậy câu có từ hoặc nơi dùng 500.
- Không đổi API, schema hay sự kiện. Không cần migration.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Tìm "nhậu" không kéo cả bảng | Có | `explore.spec.ts` › không kéo cả bảng (100 dòng); đo thật: 5917 → 500 dòng |
| Không chặn event loop / không làm chậm request khác | Có | Đo bên dưới: ~200 ms → ~14–22 ms |
| Câu có từ hoặc nơi không mất kết quả | Có, trừ câu > 500 dòng mỗi nhánh | So 6 kết quả đầu của 8 câu trước/sau (bên dưới) |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api` khi Postgres chưa chạy: 3119 pass, 4 skip, 0 fail; typecheck pass; lint 0 lỗi (130 cảnh báo).
- Khi Postgres local đang chạy, test e2e tự bật: 4 test fail ở `access/service-token.e2e`, `commerce/mock-payment.e2e`, `content/media/media-upload.e2e`, `content/moderation/api/moderation.e2e`, `discovery/recommend/eval/recommend-eval` (timeout 5 s khi chạy song song). Chạy riêng 5 file này: 63/63 pass. Không liên quan thay đổi này.
- `explore.spec.ts` › test mới: bỏ trần đi thì test fail (150 thay vì 100).

### Đo trên Postgres local (5917 tài liệu: plans 2543, stays 2214, videos 635, sights 280, eats 245)
Gọi thẳng `searchExplore` với `DrizzleExploreStore` (không qua HTTP), mỗi câu 10 lần, `perSection` 1000.

| Câu | Trước | Sau |
|---|---|---|
| nhậu, quán nhậu, ăn gì, khách sạn, lịch trình | 5917 dòng · 6.8 MB · p50 180–260 ms, max 602 ms | 500 dòng · 0.6 MB · p50 ~21 ms |
| bún bò | 226 dòng · p50 34 ms | 226 dòng · p50 29 ms |
| đà lạt, khách sạn đà lạt | 878 dòng · p50 ~36 ms | 878 dòng · p50 ~26 ms |

Câu SQL trong Postgres vốn đã nhanh (dưới 4 ms mỗi nhánh). Chi phí nằm ở khâu kéo JSONB về Node và xếp hạng.

**Event loop:** 3 người cùng tìm "nhậu", trong lúc đó một timer 5 ms giả lập request khác.

| Phiên bản | Event loop bị chặn tối đa | Heap tăng |
|---|---|---|
| Trước (không trần, chép mảng) | ~200 ms | ~53 MB |
| Không trần, `push` | ~155 ms | ~34 MB |
| Trần 500, vẫn chép mảng | ~200 ms | ~67 MB |
| Sau (100/500 + `push`) | 14–22 ms | 2–7 MB |

**So 6 kết quả đầu mỗi mục, trước/sau**, với 8 câu: bún bò, đà lạt, khách sạn đà lạt, hải sản nha trang, cafe hà nội, homestay đà lạt, lịch trình phú quốc, nhậu.
- Mọi câu có từ hoặc nơi giữ nguyên 6 kết quả đầu.
- Tổng số giảm nhẹ: "cafe hà nội" chỗ ở 198 → 184, "lịch trình phú quốc" chỗ ở 86 → 76.
- "nhậu" đổi kết quả. Không sao, vì trước đó nó vốn trả cả bảng chứ không lọc theo chữ "nhậu".

## Cách kiểm lại
1. `pnpm vitest run src/modules/discovery/search/domain/explore/explore.spec.ts -t "không kéo cả bảng"` trong `apps/core-api`.
2. Đo thật: `pnpm stack:infra`, dựng chỉ mục, `pnpm --filter @tripflix/core-api build`. Sau đó viết script Node import `dist/.../rank.js` (`searchExplore`) và `dist/.../drizzle-explore.store.js` với `createDb(createPool({ url: DATABASE_URL_DISCOVERY }))`, bọc `store.candidates` để đếm dòng, rồi đo câu "nhậu".

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `discovery/search` (Duy).

## Còn lại (task sau)
- 500 dòng được lấy theo `ord`, không theo chất lượng hay độ khớp. Câu khớp hơn 500 bài mỗi nhánh có thể sót bài tốt. Nâng cấp: sắp `ord` theo quality lúc `buildIndex`, hoặc `ORDER BY` số từ khớp trong SQL.
- "nhậu"/"quán nhậu" trong lexicon có trọng số 0 nên không lọc theo chữ "nhậu". Sửa trọng số làm đổi kết quả tìm, nên cần chạy bộ đánh giá.
- `QueryTopicUseCases.classify()` gọi `/embed` cho từ chưa có trong `PHRASE_BINS` (vd "nhậu"); chưa đo.
