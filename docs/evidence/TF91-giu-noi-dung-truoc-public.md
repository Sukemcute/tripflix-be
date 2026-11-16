# TF91 — Giữ nội dung trước khi public

- Jira: [SCRUM-119](https://tripflix.atlassian.net/browse/SCRUM-119)
- Trang, dùng AI: có; ngày 2026-11-16; nhánh `trang/TF91-giu-noi-dung-truoc-public`.

## Đã làm
- `ContentGatePort` của social do moderation cài đặt bằng luật thuần. Chỉ SCAM_PATTERN/THREAT giữ ngay; luật khác và AI tiếp tục screening.
- Publish/update/add/edit precheck trước transaction; publish/update từ chối bản ghi đã thay đổi từ lúc precheck đến khi lấy khoá. Draft vẫn là draft, nội dung held sửa sạch vẫn chờ staff.
- Bài/bình luận bị giữ phát `content.*.held`, không phát sự kiện công khai và không cộng bộ đếm bình luận. Bản sửa bài đã đăng vẫn phát updated để discovery gỡ. Sửa gốc bình luận bị giữ thì giữ reply đang hiện cùng lần, trừ bộ đếm theo số bản ghi thực tế.
- Tác giả/staff thấy bình luận held trong danh sách; người khác, thống kê và mẫu AI chỉ thấy visible.
- Screening mở hồ sơ held trước khi gọi AI; lỗi AI vẫn có hồ sơ và deferred scan. Không tự đổi held thành hidden. Queue và KPI pending nhận held.
- Dismiss/restore held nhả qua ChangeVisibility, có khoá bài và cập nhật theo trạng thái cũ. Nhả bài đặt publishedAt lúc nhả và phát published; bình luận mới phát created, bình luận đã public rồi bị giữ phát restored. Chỉ phục hồi reply thuộc cùng lần giữ.
- Sự kiện giao lại cho cùng phiên bản đã được staff nhả không tự ẩn lại. Quyết định hide/remove và parent chưa hiển thị vẫn được bảo vệ.
- API publish thêm held, publishedAt nullable khi chưa public; comment thêm status tùy chọn để giữ tương thích client cũ. Sinh hợp đồng OpenAPI và hai schema sự kiện từ nguồn.

## Kiểm tra
- Lint/typecheck/unit trước lượt kiểm cuối: 49/49 task, core-api 2485 pass, 4 skip có sẵn.
- Test luật gate gồm lừa đảo/đe doạ, câu bình thường, chửi tục không giữ nhanh và mời chuyển khoản không số tài khoản.
- `pre-publication.int.spec.ts`: 8 kịch bản Postgres cho held, dismiss đồng thời, cascade, publishAt, updated event, AI down, chống re-hide, rollback. Test gate kiểm `isTransactionActive() === false`.
- Local integration chưa chạy được: Docker báo không tìm thấy container runtime, kể cả sau restart. Chờ CI xác minh; chưa coi integration đạt.

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `cd apps/core-api && pnpm exec vitest run --config vitest.int.config.ts src/modules/content/moderation/application/pre-publication.int.spec.ts`
3. `pnpm contracts:build`, kiểm không sinh diff mới.

## Ảnh hưởng
- Social: Thành; moderation: Trang; contracts dùng chung: Dũng. Kế hoạch và hướng chỉnh social/Admin đã được Thành duyệt, Thành review PR.
- FE Admin có PR TF91 riêng, hỗ trợ held ở chi tiết bài, bộ lọc, nhãn hàng chờ và nút cho hiển thị.

- Lượt kiểm cuối sau xử lý chặn comment dưới bài held và khôi phục bài chưa từng public: 49/49 task pass, core-api 2485 pass, 4 skip. Bổ sung integration case held -> hide -> restore xuất bản lần đầu.
