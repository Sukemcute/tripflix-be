# TF39 — Gợi ý phần còn thiếu của chuyến (phần backend)

- Jira: [SCRUM-43](https://tripflix.atlassian.net/browse/SCRUM-43) · Nhánh: `duy/TF39-goi-y-phan-con-thieu` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-18

## Đã làm
- `POST /api/recommendations/trip-addons` (công khai, chỉ đọc): nhận các mục đang chọn **trước khi giữ chỗ** và số khách. Có phòng, chưa có vé thì gợi ý vé khứ hồi; có vé, chưa có phòng thì gợi ý khách sạn; đủ cả hai thì không gợi ý. Kết quả chia nhóm tiêu chí (chip), mỗi mục kèm nhãn lý do. Mục được chọn gửi chung với các mục cũ trong **một** `POST /checkout` (giữ chỗ chung, trả tiền một lần), không cần sửa commerce.
- Phạm vi theo PRD 0.3.2 (nhóm trưởng chốt 17/11): gộp đơn chỉ trên mobile; FE do người khác làm.
- Gợi ý chạy qua recsys của discovery, cùng khuôn với gợi ý bài:
  - Builder `hotel_profile@v0`, `flight_profile@v0` dựng hồ sơ mỗi chu kỳ job đặc trưng (10 phút) vào bảng mới `recommend_product_features` (migration `20261117170055_pale_exiles`, chỉ tạo bảng). Builder lỗi thì giữ hồ sơ cũ, ghi `recommend_job_state`.
  - Ranker `trip_stays@v0`, `trip_flights@v0` chấm theo nhóm, nhân độ hợp ngân sách chung (`rankers/budget-fit.ts`): mốc = phân vị giá thật của đúng ngày (tiết kiệm 30, vừa phải 60, cao cấp không mốc), quá 1,3 lần mốc thì giảm theo hàm mũ, dưới 0,5 không vào nhóm nào trừ nhóm giá rẻ. Thông số ở `DEFAULT_TRIP_*_PARAMS`.
- Ghép nơi ↔ sân bay theo nơi mà từng chuyến bay phục vụ (Côn Đảo → VCS, Vũng Tàu → SGN); chiều về bay từ khách sạn cuối.
- Chỉ đọc commerce qua `CommerceFacade` (`listCatalog`, `checkAvailability`); dùng lại `StaysUseCases`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Đặt phòng Nha Trang thấy gợi ý vé tới Nha Trang và thêm được vào cùng đơn (phần BE) | Đạt (BE) | `trip-addons.use-cases.spec.ts`; gọi thật: khách sạn Nha Trang → vé SGN → CXR; giữ chỗ thật phòng + 2 vé gợi ý trong một `POST /checkout` → `201`, tổng đơn khớp tổng giá gợi ý, rồi huỷ |
| Không gợi ý lại thứ đã có | Đạt | `trip-addons.spec.ts` (`planTripAddons`), ca "đủ phòng và vé" |
| Có vé thì gợi ý khách sạn | Đạt | `trip-addons.use-cases.spec.ts`, quét 22 sân bay |
| Màn hình mobile | Chưa | Phần FE, người khác làm |

## Kết quả kiểm tra
- `pnpm typecheck` (core-api): 0 lỗi. `oxlint --type-aware src/modules/discovery`: sạch.
- `vitest run src/modules/discovery`: 290 pass, 4 skip.
- Đánh giá trên DB local (seed giả lập): quét mọi nơi, 28 ca biên, giữ chỗ thật, đóng vai 8 người dùng. Báo cáo ở thư mục tài liệu riêng của Duy (`reports/2026-11-17-tf39-danh-gia-goi-y.md`).

## Cách kiểm lại
1. `pnpm stack:be`, đợi job đặc trưng gợi ý chạy (lúc khởi động).
2. `POST /api/recommendations/trip-addons` với `{"adults":2,"items":[{"type":"hotel","hotelId":"<khách sạn Nha Trang>","checkIn":"2026-12-08","checkOut":"2026-12-11"}]}` → `flights.outbound`, `flights.inbound` có chuyến SGN ⇄ CXR, chia nhóm.
3. Gửi `items` là vé SGN ⇄ CXR kèm `budgetLevels: ["saving"]` / `["premium"]` → khách sạn ở Nha Trang, nhóm và mốc giá đổi theo mức chi phí.

## Ảnh / video
- Không đổi giao diện (chỉ backend).

## Ảnh hưởng tới phần của người khác
- Không sửa code của người khác. Đọc thêm `CatalogHotel.city`, `CatalogOption.ratePlans` (commerce, Thắng) qua facade.
- Contract mới cho FE mobile (Trang) và web: endpoint `trip-addons`; cần `pnpm gen:api`.
