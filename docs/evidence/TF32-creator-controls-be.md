# TF32 — Bộ lọc bình luận của chủ bài

- Phạm vi: yêu cầu trực tiếp của người dùng trong chat; tiếp tục luồng kiểm duyệt TF32.
- Nhánh nguồn: `feature/creator-comment-controls`; nhánh PR: `trang/TF32-bo-loc-chu-bai`.
- Ngày: 18/11/2026. Dùng AI: có.

## Thay đổi và nghiệm thu

[Báo cáo chi tiết](2026-11-18-creator-comment-controls.md) ghi API, quyền, Unicode matching, các migration, quy tắc creator/platform hold, rollback và cách triển khai.

- Core API: 2.795 test đạt, 4 skip có sẵn (giới hạn 4 worker).
- Integration module content: 122 test / 16 file đạt trên PostgreSQL thật.
- Notification: 12 test đạt. Core/notification typecheck, Core build/export OpenAPI đạt.
- API/sự kiện chỉ thêm trường; artifacts đã sinh lại. Hai migration mới additive, backfill held cũ và lần đầu công khai.

## Ảnh hưởng

Content/social (Thành/Trang), moderation (Trang), schema content (Phong/Thành/Trang), contracts và notification (Dũng/Duy). Chủ code có thể review qua PR; không ghi nhận thay người khác rằng đã phê duyệt.

Chạy migration và triển khai BE trước FE tương ứng. Không tự nhả bình luận held khi rollback hoặc đổi keyword.
