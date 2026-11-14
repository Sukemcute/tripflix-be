# TF93 — Sửa luật chửi tục bắt nhầm khi bỏ dấu tiếng Việt

- Jira: [SCRUM-117](https://tripflix.atlassian.net/browse/SCRUM-117) · Nhánh: `trang/TF93-luat-chui-tuc-xet-dau` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-14

## Đã làm
- Luật `PROFANITY` trong `moderation/domain/rules.ts` trước đây so trên cả câu đã bỏ dấu. Từ TF88 luật này tự ẩn, nên câu bình thường bị ẩn thật: "tháng cho chắc" (= "thằng chó"), "dù mà trời mưa" (= "đụ má"), "mất lớn tiền vé" (= "mặt lồn").
- Cách mới (`findProfanity`):
  - Vẫn tìm ứng viên trên bản bỏ dấu bằng `PROFANITY_PATTERN` như cũ. Bản bỏ dấu giữ đúng vị trí từng ký tự với câu gốc.
  - Người viết gõ có dấu ở đoạn khớp: đoạn đó phải khớp dạng có dấu trong `ACCENTED_PROFANITY_PATTERN` (ví dụ "thằng chó", "đụ má", "mặt lồn") mới tính.
  - Người viết gõ không dấu: giữ cách so cũ, vì không phân biệt được "du ma" với "dù mà".
  - Xét mọi đoạn khớp trong câu, nên câu có một đoạn trùng vô hại rồi mới chửi thật vẫn bị bắt.
- Chửi tục **vẫn nằm trong danh sách tự ẩn** (`severity.ts` không đổi).
- Không đổi `normalizeText`, API, sự kiện hay schema. Các luật khác (SĐT, link, lừa đảo, đe doạ, phản động) không đổi.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| 6 câu Thành gửi và các câu bình thường không khớp `PROFANITY` | ✅ | `rules.spec.ts` › "Chửi tục xét dấu (TF93)" › "không bắt nhầm câu gõ có dấu" (10 câu, kiểm cả không tự ẩn) |
| Câu chửi thật vẫn bị bắt khi gõ có dấu và không dấu | ✅ | "vẫn bắt chửi tục gõ có dấu" (7 câu, lý do tự ẩn `HARASSMENT`), "vẫn bắt chửi tục gõ không dấu" (5 câu); toàn bộ ca TF88 cũ vẫn pass |
| Lint, typecheck, test pass | ✅ | Mục "Kết quả kiểm tra" |

## Kết quả kiểm tra
- `vitest run …/moderation/domain/rules.spec.ts`: 139/139 pass.
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công. core-api 2409 test pass, 4 skip có sẵn. Lint 0 lỗi (core-api còn 109 warning có sẵn).
- `vitest run --config vitest.int.config.ts src/modules/content/moderation` (Postgres thật): 30/30 pass.

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `cd apps/core-api && npx vitest run src/modules/content/moderation/domain/rules.spec.ts`

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `content/moderation` (Trang).
- Giới hạn còn lại: câu gõ không dấu như "du ma troi mua" vẫn bị bắt như trước, vì không có dấu để phân biệt. Câu gõ lẫn (đoạn khớp có dấu nhưng sai dấu, ví dụ "thằng cho") sẽ không bị luật bắt mà để AI xét.
