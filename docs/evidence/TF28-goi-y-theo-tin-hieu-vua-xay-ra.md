# TF28 — Gợi ý "Dành cho bạn" theo tín hiệu vừa xảy ra, tìm theo chủ đề, chuyến đã đặt

- Jira: TF28 · Nhánh: `duy/TF28-tin-hieu-bai-ngoai-ung-vien` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-19

## Đã làm

**Nơi đang tìm hiểu (trip_v1, feed-policy)**
- Tương tác lên bài nằm ngoài danh sách ứng viên (thích bài viết khi đang xem Reels) giờ được tính: `loadViewer` đọc meta mọi bài người xem đã đụng tới.
- Nơi vừa tìm / vừa tương tác dẫn đầu: dấu hiệu nhân thêm tới ×4 khi vừa xảy ra, phần thêm giảm một nửa mỗi giờ; tìm xen kẽ nhiều nơi cùng lúc thì các nơi ngang nhau. Tương tác lẻ (một lượt thích) chỉ đẩy nơi lên vài giờ, không tự thành "đang tìm hiểu".
- Trần nơi đang nhắm 5/10 → 4/10. Trộn theo khối 10 bài: khối đầu đưa 4 bài của nơi vừa chú ý lên đầu, mỗi khối sau bớt 1 (tối thiểu 1).

**Không lặp bài giữa các trang**
- Xếp hạng theo mốc trang đầu (sessionAt) thay vì giờ gọi; giữ trước tập bài khám phá cho cả phiên và bỏ chúng khỏi danh sách xếp hạng. (Job 10 phút chạy giữa hai trang vẫn có thể làm thứ hạng đổi: FE bỏ bài trùng, PR FE riêng.)

**Tìm theo chủ đề**
- Câu tìm → ngăn chủ đề: từ khoá trước; không ra thì nhúng câu tìm qua ai-service `POST /embed` (chạy nền sau khi đã trả kết quả, giới hạn 2 giây, cache theo hash), nhận ngăn khi hơn ngăn thứ hai ≥ 0,01.
- `discovery.search.performed` thêm trường `exps` (chỉ thêm, mặc định `[]`; không gửi câu tìm gốc). Đã chạy `pnpm contracts:build`.
- Gợi ý cộng chủ đề vừa tìm, lý do "Vì bạn vừa tìm bài về …". Log `recommend.query_topics` (đường đi keyword / embed / embed_unclear / embed_timeout…, không ghi câu tìm).
- Suy chủ đề từ các nơi đang tìm hiểu: hồ sơ chủ đề của nơi từ **kiểu khách sạn commerce** (job hồ sơ khách sạn lưu thêm `style`; biển/núi/resort → ngăn, tỉ lệ vượt mặt bằng) là nguồn chính, hồ sơ từ bài là nguồn phụ; điểm riêng nhân 0,5; lý do "Vì bạn đang tìm hiểu các nơi có …".

**Chuyến đã đặt**
- Đơn ghi mã loại phòng `<khách sạn>--<phòng>` nên trước đây gợi ý không tra ra nơi, không bao giờ vào giai đoạn sắp đi / đang đi. Tra nơi qua khách sạn chứa phòng; `trip.hotelId` là mã khách sạn.
- Nhiều chuyến trùng thời gian: đang đi là chuyến vừa bắt đầu gần nhất.

## Đối chiếu "Xong khi"
| Tiêu chí (yêu cầu của Duy 19/11) | Đạt | Bằng chứng |
|---|---|---|
| Tìm + thích bài Hà Nội thì "Dành cho bạn" chuyển sang Hà Nội | Có | Local: 0/10 → Hà Nội đứng đầu; test `trip-answers.spec.ts` (bài viết ngoài ứng viên) |
| Nơi vừa tìm/tương tác dẫn đầu, nơi cũ nhạt dần, tìm xen kẽ thì ngang nhau | Có | Local: Nha Trang 3 giờ trước, Hà Nội 1,5 giờ, Hội An vừa tìm → Hội An ×4 đầu, Hà Nội ×2, Nha Trang ×1; test "nhảy nơi khi đang tìm chỗ đi" |
| Trang đầu 3–4 bài nơi vừa chú ý, trang sau giảm dần | Có | Local 5 trang: 4, 3, 2, 1, 1; test `feed-policy.spec.ts` |
| Không lặp bài (React trùng key) | Có (BE + FE) | Test 10 trang gọi cách 7 phút không trùng; local 47 bài/5 trang không trùng |
| Tìm "núi", "biển" (và câu không có từ khoá) cũng đổi gợi ý | Có | Local: "đi đảo lặn san hô" → embed → `exp:bien`, 9/10 bài biển; `query-topics.use-cases.spec.ts` |
| Tìm nhiều nơi biển thì hiểu đang quan tâm biển | Có | Local: tìm Nha Trang, Phú Quốc, Quy Nhơn → "các nơi có biển đảo" ×6/10; Đà Lạt, Sa Pa → "núi" ×6/10; `place-topics.spec.ts` |
| Đặt phòng thì gợi ý chuyển sang đang đi | Có | Local: đơn Nha Trang 19–22/11 → 4 bài đầu "Cho chuyến Nha Trang 19/11 của bạn"; test đơn mã loại phòng, hai chuyến trùng |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected` (sau khi merge `origin/develop`): xem PR.
- Test discovery: 388 pass (4 skip có sẵn).
- Bộ đo offline (`recommend/eval/report.md`): trần 4/10 làm "đúng nơi@10" của các ca lên kế hoạch / sắp đi / đang đi 0,50 → 0,40 (ngưỡng mục tiêu hạ 0,5 → 0,4 theo trần mới), "số nơi@20" tăng (vd 8→10, 6→7, 5→7). Các thay đổi sau không làm "đúng nơi" giảm thêm.
- Đo biên embed câu tìm trên 46 câu mẫu (`recommend/eval/query-topics.samples.json`): từ khoá bắt 23/23 đúng; 23 câu còn lại qua embed ở biên 0,01 gán 12 (đúng 11, sai 1), không gán câu mơ hồ nào. Tên nơi trơn (Phú Quốc, Quy Nhơn, Đà Lạt) embed không biết chủ đề (biển hạng 8–9/9) → dùng kiểu khách sạn.

## Cách kiểm lại
1. `pnpm stack:up` + profile ai; nối core-api với ai-service cần `AI_SERVICE_URL`, `CORE_API_INTERNAL_URL`, `MODERATION_SERVICE_CLIENT_SECRET` (tài khoản dịch vụ `core-api`, audience `ai-service`). Không có thì chỉ chạy đường từ khoá.
2. Đăng nhập, tìm "hà nội" / "nha trang", thả tim vài bài, mở `GET /api/recommendations/reels?mode=for_you` và xem `reason.text`.
3. `docker logs tripflix-core-api-1 | grep recommend.query_topics` để thấy câu tìm đi đường từ khoá hay embed.

## Ảnh hưởng tới phần của người khác
- `libs/contracts` (Dũng): thêm trường `exps` (mặc định `[]`) vào `DiscoverySearchPerformedV1Schema`; `contracts/events/discovery.search.performed.v1.schema.json` sinh lại. Chỉ thêm, sự kiện cũ vẫn hợp lệ.
- Không sửa code commerce/content; chỉ đọc thêm `style` từ `CommerceFacade.listCatalog` (đã có sẵn).
