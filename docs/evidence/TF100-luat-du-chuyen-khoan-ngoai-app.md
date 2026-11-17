# TF100 — Luật dụ chuyển khoản/đặt cọc ngoài app không kèm số tài khoản

- Jira: [SCRUM-124](https://tripflix.atlassian.net/browse/SCRUM-124) · Nhánh: `trang/TF100-luat-du-chuyen-khoan-ngoai-app` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Trước đây câu dụ chuyển tiền ra ngoài app mà chưa ghi số tài khoản (ví dụ "ib zalo chuyển khoản cọc giữ phòng") chỉ khớp `CONTACT_INVITE` (trọng số 20), nên nằm cuối hàng chờ cùng các câu chỉ để lại Zalo. Câu có số tài khoản thì đã bị `SCAM_PATTERN` tự ẩn.
- Luật mới `OFF_PLATFORM_PAYMENT` (category `SCAM`, trọng số 65) trong `moderation/domain/rules.ts`. Khớp khi câu có **cả hai vế**:
  - Đòi tiền: chuyển khoản/tiền/cọc, `ck` cọc/trước, đặt cọc, cọc trước/giữ phòng, thanh toán trước, xin/gửi STK.
  - Kéo ra ngoài app: zalo, telegram, messenger, inbox/ib, nhắn riêng, kết bạn, hoặc có số điện thoại (`PHONE_VN`).
  - Không thêm khi câu đã có số tài khoản (đã là `SCAM_PATTERN`).
- Trọng số 65: hồ sơ lên đầu hàng chờ, nhãn "Trung bình" trên Admin, dưới ngưỡng khẩn cấp 80. **Không** thêm vào danh sách tự ẩn (`severity.ts`) và **không** giữ lúc đăng (`content-gate.ts` chỉ giữ `SCAM_PATTERN`, `THREAT`).
- Lý do của hồ sơ trước lấy theo luật khớp đầu tiên, nên "ib zalo 0912… chuyển khoản cọc" bị ghi lý do spam (`PHONE_VN` khớp trước). Giờ lấy theo luật có trọng số cao nhất → `SCAM`.
- Không đổi API, sự kiện, schema.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Câu dụ chuyển tiền ngoài app không có STK khớp `OFF_PLATFORM_PAYMENT`, severity ≥ 60 và < 80, không tự ẩn | ✅ | `rules.spec.ts` › "Dụ chuyển khoản/đặt cọc ngoài app…" › 8 câu (có in hoa, số điện thoại, telegram, messenger) |
| Câu bình thường không khớp ("chuyển khoản qua app Tripflix nhé", "đặt cọc trên app được không", "khách sạn yêu cầu đặt cọc 30%", "nhắn zalo cho bạn mình hỏi đường", "zalo nhóm đi Đà Lạt") | ✅ | Cùng file, 7 câu |
| Ca TF88/TF93 cũ vẫn pass; lint/typecheck/test pass | ✅ | Mục "Kết quả kiểm tra" |
| Thêm: luồng quét thật trên Postgres | ✅ | `moderation.int.spec.ts` › "dụ chuyển khoản ngoài app không có STK: không tự ẩn, hồ sơ mức 65, lý do SCAM". Trả lại cách lấy lý do cũ thì test này fail |

## Kết quả kiểm tra
- `vitest run …/moderation/domain/rules.spec.ts`: 172/172 pass.
- `vitest run --config vitest.int.config.ts src/modules/content/moderation` (Postgres thật): 2 file, 39/39 pass.
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công. core-api 2555 test pass, 4 skip có sẵn. Lint 0 lỗi (warning có sẵn, không có warning mới ở code TF100).

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `cd apps/core-api && npx vitest run --config vitest.int.config.ts src/modules/content/moderation` (cần Docker)

## Ảnh / video
- Không đổi giao diện. Admin hiện nhãn chung "Bộ lọc phát hiện dấu hiệu" cho mã mới; thêm nhãn riêng "Nghi dụ chuyển tiền ngoài app" trong `apps/admin/src/features/moderation/risk-level.ts` là việc FE làm sau.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `content/moderation` (Trang).
