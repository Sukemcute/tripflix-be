# TF13 — Bộ 50 câu tìm kiếm thử và cách chấm

- Notion: https://app.notion.com/40dcb9b9e5c281f69336f3a43b05be24 · Jira: SCRUM-17 · Nhánh: `duy/TF13-bo-cau-tim-kiem` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-05

## Đã làm

- `apps/core-api/src/modules/discovery/search/eval/queries.json`: 50 câu tìm kiếm kiểu người trẻ, phân bố cố định:
  - 8 câu có dấu, rõ ràng; 10 câu không dấu hoặc viết tắt; 10 câu tiếng lóng, trộn tiếng Anh, emoji; 10 câu có ngân sách, số người, số đêm.
  - 7 câu bẫy: nơi không có, chỗ không tồn tại, ràng buộc không thể. 5 câu ngoài phạm vi: ngoài du lịch, vô nghĩa, có hại.
  - Theo luồng: 44 câu tìm chỗ ở, 6 câu tìm bài đăng.
  - Mỗi câu có cách hiểu đúng (`expect`: nơi, loại chỗ, sao, thương hiệu, số khách, số đêm, ngân sách, ý muốn mềm) và kiểu chấm (`top1` / `empty` / `refuse`).
  - Dựa trên bộ câu của POC F4, viết lại cho khớp dữ liệu seed commerce thật.
- `README.md` cùng thư mục: cách chấm "kết quả đầu đúng ý".
  - Ràng buộc cứng do máy kiểm; ngân sách không bao giờ được vượt.
  - Ý muốn mềm do hai người chấm độc lập, lệch thì người thứ ba quyết.
  - Tham số đo cố định: nhận phòng = ngày đo + 14 ngày.
  - Mục tiêu ≥ 40/50, báo điểm theo nhóm; luật version khi đổi bộ câu.
- `check-queries.mjs`: đối chiếu bộ câu với seed commerce (`catalog.json`), tính giá đúng như `seed-catalog.ts`. Mỗi câu `top1` phải có ít nhất một khách sạn thoả, mỗi câu bẫy phải không có khách sạn nào thoả. Chạy lại khi seed commerce đổi.

## Đối chiếu "Xong khi"

| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng |
|---|---|---|
| File bộ câu + đáp án | Có | `queries.json` (50 câu, `expect`, `judge`), `README.md` (cách chấm) |
| Trang đưa vào bản đề xuất cách đo | Chờ Trang | Gửi Trang link `README.md` sau khi PR merge |

## Kết quả kiểm tra

- `node apps/core-api/src/modules/discovery/search/eval/check-queries.mjs`: "Bộ câu khớp seed commerce".
  - 40 câu `stays` được máy kiểm: 33 câu `top1` có 1–10 khách sạn thoả, 7 câu bẫy không có khách sạn nào thoả. 10 câu còn lại (bài đăng, từ chối, vô nghĩa) chấm tay.
  - Q35 ban đầu đặt ở Quy Nhơn nhưng không có căn nào cho 8 người, đã đổi sang Hội An trước khi cố định.
- `pnpm turbo run lint typecheck`: lint 0 lỗi, typecheck pass.
- Test: chạy riêng `pnpm vitest run` trong `apps/core-api` được 205/205 pass. Khi chạy qua turbo song song với các task khác, vài test e2e của module khác có lần vượt timeout vì máy tải nặng. Nhánh này không có file `.ts` nào.

## Cách kiểm lại

1. `node apps/core-api/src/modules/discovery/search/eval/check-queries.mjs`: in từng câu, số khách sạn khớp và 2 ví dụ kèm giá.
2. Đọc `README.md` cùng thư mục để biết cách chấm.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không sửa code của ai. Script chỉ đọc file seed `commerce/db/seed/catalog.json` (Thắng), không import code commerce. Seed đổi thì chạy lại script; câu nào hết đáp án thì sửa ở `version: 2`.
