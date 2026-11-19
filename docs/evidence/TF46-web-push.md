# TF46 — Web Push từ hộp thư thông báo

- Notion: chưa có task riêng được cung cấp; phạm vi theo yêu cầu trong chat.
- Nhánh: `dung/TF46-web-push` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-19.
- Frontend đi kèm: `dung/TF46-thong-bao-web-va-tab` trong tripflix-fe.

## Đã làm

- Thêm web-push và @types/web-push sau khi người dùng đồng ý.
- GET/POST/DELETE `/notifications/web-push`, tất cả cần đăng nhập. GET chỉ trả enabled/publicKey; POST lấy userId/sid từ JWT, không nhận userId do client chỉ định. DELETE giới hạn chủ sở hữu.
- Kiểm tra endpoint HTTPS của nhà cung cấp push được hỗ trợ, chặn URL tùy ý/SSRF; kiểm tra kích thước khóa P-256/auth.
- Migration 12 thêm subscriptions và deliveries riêng cho Web; giữ nguyên push mobile/email và migration đã có. Đăng ký lại cùng user/sid giữ id/mốc tạo; đổi tài khoản/phiên đổi binding, không phát lại lịch sử.
- Worker dùng PostgreSQL advisory lock giữa các replica, tối đa 40 delivery/lượt, 4 request đồng thời, timeout 5 giây. Không gọi mạng trong transaction ghi dữ liệu.
- Một delivery trên mỗi notification/device; chỉ gửi lần đầu cho id, không phát lại khi dòng gom đổi nội dung. Retry backoff tối đa 5 lần; endpoint 404/410 bị xóa; 429/5xx chờ thử lại.
- Chỉ gửi mục chưa đọc, chưa ẩn/xóa; kiểm tra SID bị thu hồi và hạn phiên. Bài follower dùng chung cũng được đọc qua quan hệ follower, không tạo một triệu inbox mới.
- Payload giới hạn title/body, chỉ mang các id định tuyến và actor cuối; không gửi toàn bộ metadata inbox. Không ghi endpoint/khóa/nội dung cá nhân ra log.
- Dọn dữ liệu cũ theo lô tối đa 1000/lượt. Thêm index cho thời hạn đăng ký, delivery và bài follower gần đây.
- Hợp đồng `contracts/openapi/notification-web-push.json` sinh từ schema nguồn bằng `pnpm --filter @tripflix/notification-service export:web-push-openapi` sau build.
- Compose local/server và env.example đã có biến Web Push, mặc định tắt.

## Kiểm tra

- `pnpm turbo run lint typecheck test build --affected --concurrency=1 --output-logs=errors-only`.
- `node tools/check-boundaries.mjs`: không vi phạm.
- Notification unit/API: 158 test pass, gồm HTTP auth/SSRF/key validation/config không lộ private key.
- Full notification integration: 68/69 pass ban đầu, assertion đếm migration 11 cần đổi thành 12. Sau cập nhật, chạy lại inbox + Web Push: 16/16 pass; bổ sung một ca giữ thiết bị mới rồi chạy lại Web Push 8/8 pass. Tổng cộng 70 ca integration đã được kiểm tra qua các lượt; các suite còn lại đã pass. Không skip hoặc nới lỏng test.
- Ca Web Push PostgreSQL: nhiều thiết bị, không phát lịch sử, đổi tài khoản/gia hạn, cap 10 máy, xóa theo chủ, SID hết hạn/thu hồi, thông báo đã đọc/ẩn, 410, 429/backoff 5 lần, hai worker chạy đồng thời, follower dùng chung.
- Gửi nhà cung cấp Web Push được mock trong test; chưa xác minh thông báo hệ điều hành thật với VAPID trên môi trường deploy.

## Bật trên môi trường

1. Deploy cả hai nhánh frontend/backend tương ứng.
2. Tạo một bộ VAPID cho môi trường; giữ khóa riêng trong cấu hình bí mật của server. Không gửi khóa riêng qua chat/commit. Xem công cụ `pnpm exec web-push generate-vapid-keys` để tạo khóa trên máy quản trị phù hợp.
3. Đặt `WEB_PUSH_ENABLED=true`, `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (mailto hoặc HTTPS thật). Không đưa private key vào biến NEXT_PUBLIC_*.
4. Đảm bảo WEB_APP_URL là origin Web đúng; chạy `pnpm --filter @tripflix/notification-service db:migrate` trước khi khởi động bản mới (migration 12).
5. Khởi động lại notification-service; người dùng bấm Bật thông báo trên máy này ở hộp chuông, cấp quyền.
6. Test ở nền bằng một tài khoản khác trả lời bình luận. Test logout/đổi tài khoản và endpoint hết hạn; xem inbox để đối chiếu.

## Giới hạn

- Đây là push khi phiên Web còn được duy trì. Lease của đăng ký chỉ tới exp access token; frontend gia hạn mỗi phút. Tab bị đóng băng quá hạn cần hoạt động lại để gia hạn, không có credential đăng nhập dài hạn trong Service Worker.
- Push best effort: chỉ quét mục tạo trong 10 phút, TTL nhà cung cấp 300 giây; quá cửa sổ thì vẫn ở inbox, không đẩy hàng loạt thông báo cũ.
- Chưa benchmark fan-out lớn. Giới hạn lô bảo vệ dịch vụ nhưng không phải cam kết giao đủ mọi push cho một triệu người trong 10 phút.
- Không đảm bảo exactly once ở đường mạng (timeout sau khi nhà cung cấp nhận); Service Worker frontend dedup theo user/id để tránh trình bày trùng.
- Không push/mở PR/triển khai production hoặc thay đổi Notion ở bước này.

## Ảnh hưởng

- Dũng: notification service, schema/migration, env, deployment wiring, hợp đồng.
- Phong: cần cấu hình bộ VAPID khi triển khai; không thay SMTP/SES hoặc push mobile.
- Hai fixture test Env và assertion migration hiện có được bổ sung theo schema mới.
