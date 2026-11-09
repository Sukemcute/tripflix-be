# TF32 — Hàng chờ kiểm duyệt và lọc tự động

- Jira: [SCRUM-36](https://tripflix.atlassian.net/browse/SCRUM-36)
- Nhánh: `trang/TF32-hang-cho-kiem-duyet` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-09

## Đã làm

- Thêm `ModerationModule`: báo cáo bài/bình luận, hàng chờ theo ưu tiên, chi tiết, bộ lọc, nhật ký và quyết định hide/restore/remove/dismiss. API quản trị dùng role guard; POST mới dùng HTTP idempotency.
- Thêm hai migration content: bảng reports/cases/processed events/idempotency; comment status và nguồn cascade; metadata nguồn summary; mở rộng audit. Không sửa migration đã có trên develop.
- Luật tiếng Việt và ngưỡng configurable; client `/moderate` lấy token core-api → ai-service qua HTTP, cache có biên an toàn, single-flight, timeout 3s/lần. Chỉ refresh/retry một lần khi 401, các lỗi cuối cùng fallback regex.
- Consumer `core-moderation`: gọi AI ngoài transaction, pha ghi loại event trùng và khoá bài. DB/outbox lỗi không bị nuốt. Sự kiện screening cũ không ghi đè quyết định staff mới hơn.
- Cascade ẩn phản hồi visible; restore chỉ phản hồi thuộc lần ẩn đó, chưa xoá, chưa bị ẩn riêng. Add/delete/hide dùng cùng khoá post; delta chỉ tính dòng thực sự đổi, gọi incrementCounter có chặn âm.
- Giữ đường kiểm duyệt post cũ, dùng lại nó từ luồng queue; thêm outbox post hidden/restored và comment hidden/restored, moderation decided, report created.
- PUT/DB/GET summary hỗ trợ sourceCommentIds, phân biệt null và []; GET giữ metadata/hash nhưng ngừng trả văn bản có nguồn hidden/deleted/missing/khác bài. Lọc cả mục trích dẫn content/safety. PUT CAS theo generatedAt mới hơn, failed không đè ready.
- Các phần schema, bộ đếm và summary dùng chung với TF33 nằm trong TF32 theo thống nhất triển khai cùng PR migration. TF33 tiếp tục phần đo và nghiệm thu liên dịch vụ.

## Đối chiếu “Xong khi”

| Tiêu chí | Đạt | Bằng chứng |
| --- | --- | --- |
| Hàng chờ và thao tác kiểm duyệt có lý do/nhật ký | Đạt local | moderation.e2e.spec.ts; moderation.int.spec.ts |
| Quảng cáo/SĐT/link vào hàng chờ, lừa đảo STK tự ẩn | Đạt local | rules.spec.ts, regex fallback + AI verdict trong moderation.int.spec.ts |
| Ẩn/restore không lệch bộ đếm hoặc làm sống lại bình luận đã xoá | Đạt local | Postgres concurrency, cascade provenance, delete hidden và outbox rollback |
| Thứ tự hot đổi khi ẩn bình luận; ẩn bài không có trong hai tab | Đạt local | feed.int.spec.ts |
| Service-token AI thật, chất lượng trên tập eval tiếng Việt | Chưa xác nhận | Chờ cấu hình môi trường và kết quả eval của Bảo; chưa gọi OpenAI thật |

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --affected`: pass; core-api **718 test pass, 1 test skip có sẵn**; 49/49 task turbo thành công. Lint có warning ở code cũ; không tắt luật hoặc skip test mới.
- `pnpm --filter @tripflix/core-api test:int -- src/modules/content/moderation/application/moderation.int.spec.ts src/modules/content/feed/application/feed.int.spec.ts`: **22 test pass** trên Postgres Docker mới, áp dụng cả hai migration.
- `pnpm contracts:build`: sinh OpenAPI và sáu event schema thành công.
- `node tools/check-boundaries.mjs`, `git diff --check`: pass.
- HTTP token cache/retry/timeout dùng server HTTP giả chạy thật, không chỉ mock kết quả use case. AI/OpenAI staging chưa được gọi.

## Cách kiểm lại

1. Chạy ba lệnh kiểm tra ở trên; test int cần Docker.
2. Cấp client `pnpm --filter @tripflix/core-api auth:create-service-client core-api ai-service` một lần trên môi trường đích, lưu secret riêng; không đưa vào evidence.
3. Cấu hình AI_SERVICE_URL, CORE_API_INTERNAL_URL, MODERATION_SERVICE_CLIENT_SECRET theo `.env.example`; deploy migration và core trước AI gửi sourceCommentIds.
4. Dùng tài khoản test đã xác thực để đăng/báo cáo; dùng moderator để mở queue và xử lý. Kèm Idempotency-Key khi POST API mới.

## Ảnh / video

Giao diện nằm ở repo tripflix-fe; evidence frontend và ảnh chụp ngoài repo tại `.agent/evidence/TF32`. Chưa upload hoặc mở PR.

## Ảnh hưởng tới phần của người khác

- Thành: social/comment/summary API, fixture test, mở rộng audit; Phong: schema content và test feed; Dũng: thêm group và event schemas. Đã có đồng ý trong plan, gồm việc Trang sửa delete-comment cùng migration.
- Bảo: nhận sourceCommentIds ở PUT, trả lại ở GET; chờ core được deploy trước khi bật gửi. Không sửa repo AI.
- Dũng vẫn phụ trách inbox/notification; Thành phụ trách post.updated và tích hợp web theo phân công trong plan; Duy phụ trách consumer discovery. Chưa thay đổi hoặc triển khai phần của các bạn.

## Còn lại trước nghiệm thu

- Chạy luồng AI/service-token thật, nhận eval 30 câu; ghép notification/discovery/post.updated theo các PR phụ thuộc.
- Deploy migration/core trên môi trường tích hợp rồi mới báo Bảo bật metadata. Chưa có xác nhận staging đã sẵn sàng.
- Push/PR và cập nhật Jira/Notion sau khi Trang duyệt kết quả local.
