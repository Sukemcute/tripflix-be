# TF88 — Tự ẩn bình luận và bài đăng tục tĩu, xúc phạm, phản động

- Jira: [SCRUM-115](https://tripflix.atlassian.net/browse/SCRUM-115) · Nhánh: `trang/TF88-tu-an-noi-dung-vi-pham` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-13

## Đã làm
- `domain/severity.ts`: mở rộng điều kiện tự ẩn (áp dụng cho cả bình luận và bài đăng):
  - Luật từ khoá: `SCAM_PATTERN` (như cũ), thêm `EXTREMISM`, `THREAT`, `PROFANITY`.
  - AI: ngoài nhóm nguy hiểm cũ, thêm OpenAI `harassment`, `hate`, `harassment/threatening` ≥ `MODERATION_AI_THRESHOLD`, và ViSoBERT `visobert/toxic` (ngưỡng 0.97 đã áp ở tripflix-ai). Trước đây ViSoBERT, mô hình tiếng Việt, bị bỏ qua khi quyết định ẩn.
  - Trả thêm `autoHideReason` để ghi đúng lý do. Ưu tiên: SCAM > EXTREMISM > VIOLENCE > HARASSMENT, rồi tới nhãn AI.
- `domain/rules.ts`:
  - Thêm luật `EXTREMISM` cho nội dung phản động: kêu gọi lật đổ hoặc đả đảo, ủng hộ tổ chức khủng bố Việt Tân, ly khai (Đề Ga, độc lập Tây Nguyên…), xuyên tạc chủ quyền Hoàng Sa/Trường Sa, xúc phạm chế độ. Danh sách giữ hẹp, chỉ gồm cụm rõ nghĩa.
  - Vì `PROFANITY` giờ tự ẩn, luật được siết lại để không ẩn nhầm con vật và món ăn: "con chó" chỉ bắt khi nhắm vào người ("mày là con chó", "đồ con chó"), "óc chó" bỏ qua "hạt/sữa/bánh… óc chó". Thêm vài cụm tục tĩu còn thiếu.
- `domain/reason-codes.ts`: thêm mã `EXTREMISM` (chỉ thêm). Đã chạy `pnpm contracts:build`, `contracts/openapi/core-api.json` chỉ thêm giá trị enum.
- `application/moderation.use-cases.ts`: quyết định tự ẩn ghi `autoHideReason` thay vì luôn ghi `OTHER`.
- Sàng lọc vẫn chạy bất đồng bộ qua worker. Tác giả vẫn khiếu nại được, admin vẫn khôi phục được như trước.
- Test cũ của TF32 "đe doạ… không tự ẩn một mình" được sửa theo yêu cầu mới. Đây là đổi hành vi có chủ đích, không phải nới test.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bình luận/bài đăng tục tĩu, đe doạ, phản động bị tự ẩn, có hồ sơ và lý do đúng | ✅ | `rules.spec.ts`: "xúc phạm và đe doạ tự ẩn với lý do đúng", "Luật nội dung phản động (TF88)", "AI gắn cờ xúc phạm… tự ẩn"; `moderation.int.spec.ts` (Postgres thật): "bình luận tục tĩu, phản động tự ẩn dù AI lỗi, ghi đúng lý do" |
| Câu bình thường dễ trùng không bị ẩn | ✅ | `rules.spec.ts`: "không ẩn nhầm con vật, món ăn", "không bắt nhầm" (Hoàng Sa của Việt Nam, bảo tàng Hồ Chí Minh, "lật đổ mọi định kiến"…), cùng các ca sạch cũ |
| Có unit test, lệnh kiểm tra pass | ✅ | Mục "Kết quả kiểm tra" |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công. core-api: 2372 test pass, 1 skip có sẵn. Lint 0 lỗi.
- `vitest run --config vitest.int.config.ts …/moderation.int.spec.ts`: 29/29 pass.

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `cd apps/core-api && npx vitest run --config vitest.int.config.ts src/modules/content/moderation/application/moderation.int.spec.ts` (cần Docker)
3. Chạy stack local có worker (`APP_ROLE=all`), gửi bình luận "đm thằng óc chó" hoặc "đả đảo cộng sản". Vài giây sau bình luận bị ẩn, màn kiểm duyệt có hồ sơ tự ẩn với lý do Quấy rối / Cực đoan.

## Ảnh / video
- Chưa có. FE admin cần thêm nhãn cho `EXTREMISM` trước khi chụp.

## Ảnh hưởng tới phần của người khác
- `contracts/openapi/core-api.json`: thêm giá trị `EXTREMISM` vào enum `reasonCode`. FE admin (Thành) cần chạy `pnpm gen:api` và thêm nhãn tiếng Việt; nếu chưa thêm, admin sẽ hiện mã thô.
- Không đổi schema database (`reason_code` là varchar), không đổi sự kiện.
