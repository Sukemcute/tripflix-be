# BE-10 — Phân công, lease và SLA kiểm duyệt

## Bổ sung 19/11/2026: bài nguồn và ngữ cảnh bình luận

- Chi tiết staff thêm `postContext`, `parentComment`. Tách rõ tác giả bình luận và chủ bài; tra contact cả ba người qua một lượt public AccessFacade.
- Đọc post đúng postId của hồ sơ và bình luận liên quan cùng postId. Dùng replyToCommentId chính xác; dữ liệu cũ fallback parent gốc và ghi kind=thread.
- Bài/bình luận đã xóa có unavailable và không trả lại nội dung đã xóa. Không thêm context/contact vào API công khai.
- Moderation integration 57/57 đạt, gồm đúng đích reply, fallback legacy, xóa và chặn tham chiếu comment của bài khác. HTTP 9/9, typecheck/lint/contracts đạt; live Admin/API/Web đạt.
- Không thêm migration cho phần ngữ cảnh này.

## Bổ sung 19/11/2026: thông tin tác giả ở chi tiết Admin

- `ModerationDetailDto.author` trả đúng `{ id, displayName, email }` của tác giả target; không lấy thông tin chủ bài khi target là bình luận.
- Dùng lại `AccessFacade.getUserContacts`, gọi qua public facade sau pha transaction/audit; không query bảng access từ content, không đọc password hash.
- Chỉ endpoint chi tiết staff có trường này; queue và API bình luận công khai không bổ sung email. Tài khoản không còn tra cứu được trả author null.
- 13 test HTTP/facade đạt, gồm quyền guest/member bị chặn, moderator/superadmin được đọc, không trả password hash và fallback tài khoản thiếu. Lint/typecheck/contracts đạt.
- Luồng Admin/API thật với bình luận của tài khoản khác chủ bài đạt; API công khai không có email. Không cần migration mới cho phần bổ sung này.

- Phạm vi: yêu cầu trực tiếp của người dùng trong chat, tiếp nối epic kiểm duyệt TF32.
- Nhánh: `trang/TF32-be10-phan-cong-kiem-duyet`. Ngày: 18/11/2026. Dùng AI: có.
- Kế hoạch dự án: `docs/moderation/02-ke-hoach-trien-khai-fe-be.md`, mục BE-10 ở workspace VSF.

## Hành vi đã triển khai

- `POST /api/v1/admin/moderation/queue/:id/lease`: `claim`, `renew`, `release`. Chỉ moderator/superadmin; có Idempotency-Key. Renew/release phải có `leaseId` hiện tại.
- Lease 15 phút; nhận lặp khi chính mình đang giữ không kéo dài phiên hoặc ghi audit claim trùng. Gia hạn là hành động riêng. Hết hạn nhận lại được; lần nhận mới có UUID mới.
- Khóa post trước case trong transaction, cùng thứ tự với screening/report/decision. Hai người nhận đồng thời chỉ một người thành công. Quyết định và audit/outbox vẫn được ghi trong transaction.
- Quyết định, API ẩn/gỡ comment trực tiếp và API moderation bài trực tiếp không vượt được lease của người khác. Phiên đã hết hạn phải nhận lại. Client mới gửi leaseId để chặn phiên cũ cùng người dùng sau nhận lại.
- SLA vận hành ban đầu: severity >= 80 là 1 giờ, còn lại 24 giờ, tính từ lúc mở hồ sơ. Tăng severity có thể rút ngắn hạn; nhận, gia hạn hoặc report thêm không lùi hạn. Migration backfill theo created_at/severity của hồ sơ cũ.
- Queue có filter `assignment=all|unassigned|mine`, `sla=all|overdue|due_soon`, search tại server. `mine` lấy từ danh tính đã xác thực, không nhận actorId do client cung cấp.
- Cursor keyset theo severity giảm, createdAt/id tăng; giữ độ chính xác timestamp qua helper hiện có. Total đếm toàn bộ kết quả filter, không chỉ sau cursor. Vẫn nhận offset dạng số cũ, giới hạn 1.000.000. Cursor sai trả 400.
- Stats thêm `unassigned`, `assignedToMe`, `overdue`, `dueSoon`; cùng điều kiện pending/visibility với queue, không phụ thuộc số trang FE đã tải.
- Audit riêng cho claim/renew/release/evidence_view. Đọc chi tiết có ghi dấu truy cập. Quyết định staff tiếp tục ở moderation_actions; detail trả 100 audit gần nhất.

## Nghiệm thu

| Tiêu chí | Kết quả / bằng chứng |
|---|---|
| Hai Admin nhận/duyệt cùng hồ sơ không ghi đè nhau | Integration BE10 + hai phiên Admin thật |
| Không lách qua API moderation trực tiếp | Integration post/visibility và live API trả 409 |
| Lease hết hạn nhận lại; mã cũ không gia hạn/trả/duyệt | Integration + live QA chỉ làm cũ thời gian của hồ sơ QA mới tạo |
| Duyệt đồng thời chỉ ghi một quyết định | Integration, live duplicate API 409 |
| Claim/gia hạn không lùi dueAt | Integration + live |
| Stats/filters đầy đủ khi hàng chờ > 100 dòng | Integration 125 hồ sơ |
| Không mất dòng khi trang trước có hồ sơ vừa được nhận | Integration so sánh trang keyset sau mutation |
| Audit claim/release và truy cập bằng chứng | Integration + live UI lịch sử |
| API role, schema, idempotency | HTTP tests: guest 401, member 403; thiếu khóa/mã phiên sai 400 |

## Kết quả kiểm tra

- Core unit toàn bộ: 2.849 đạt, 4 skipped có sẵn. Lượt typecheck đầu phát hiện helper test trả caseId nullable; đã sửa helper kiểm tra ID trước khi trả.
- Lượt kiểm tra cuối HTTP/social: 91 đạt; typecheck và lint đạt (còn warning trong code hiện có).
- Toàn bộ content integration cuối: **133/133 đạt**, 16 file, Postgres Testcontainers, `--maxWorkers=2`.
- `contracts:build`, ranh giới module và `git diff --check`: đạt.
- Migration content `20261118161811_mighty_sunfire` đã áp trên database local.
- Admin/API thật: script FE `tools/verify-be10-live.cjs` đạt 11 nhóm kiểm tra, gồm bulk xử lý một phần mà không ảnh hưởng hồ sơ Admin khác đang giữ.

## Vận hành và triển khai

1. Chạy migration trước khi cập nhật Core; migration chỉ thêm cột/bảng/index và backfill deadline, không xóa dữ liệu cũ.
2. Triển khai Core rồi Admin tương ứng. Local đã chạy mã mới trên Core và Admin.
3. Moderator nhận hồ sơ rồi xử lý; nếu rời ca, trả hồ sơ. Không trả thì hết 15 phút người khác nhận lại được. Superadmin cũng tuân thủ lease, không có nút cướp phiên.
4. Cảnh báo overdue và scan hết lượt thử hiển thị tại Admin cho moderator/superadmin. Trưởng nhóm/superadmin là đầu mối xử lý escalation; vào filter Quá hạn hoặc Scan cần phục hồi. Chưa cấu hình gửi email/Slack ngoài hệ thống.

Tương thích: API quyết định cũ vẫn được phép xử lý hồ sơ chưa từng được nhận (`assigneeId = null`), với khóa transaction chống quyết định trùng. Khi hồ sơ đã có phiên nhận thì mọi API staff phải tuân thủ chủ phiên/hạn; client mới còn kiểm đúng leaseId. System screening vẫn hoạt động, không bị lease staff ngăn tự ẩn nội dung nguy hiểm.

Ảnh hưởng: content/moderation (Trang), content/social (Thành/Trang), content/db (Phong/Thành/Trang), hợp đồng OpenAPI sinh tự động. Không thêm thư viện, không đổi CI/cấu hình chung, không sửa Notification. Chưa triển khai production.
