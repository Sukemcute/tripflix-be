# TF44 — Bổ sung payload khi khôi phục bình luận

- Nhánh `trang/TF44-comment-restored-payload` · Trang (dùng AI) · 2026-11-13

## Đã làm

- Tách schema `content.comment.restored` khỏi `content.comment.hidden`. Sinh lại JSON schema bằng `pnpm contracts:build`.
- Mỗi event restore mới mang `body` và `parentCommentId` từ dòng bình luận vừa cập nhật, cùng `postAuthorId` từ bài viết. Bình luận gốc có `parentCommentId: null`.
- Ba trường mới là tùy chọn trong schema v1 để payload cũ vẫn hợp lệ. Payload và schema của `hidden` và `deleted` giữ nguyên.

## Kết quả kiểm tra

- `pnpm contracts:build` thành công. Chỉ JSON schema `content.comment.restored` có thay đổi trong `contracts/`.
- `pnpm turbo run lint typecheck test --affected --concurrency=5` với `TURBO_SCM_BASE=origin/develop` hoàn tất 31/31 tác vụ. Có 2.548 test pass và 1 test skip. Lint có cảnh báo và không có lỗi.
- `pnpm --filter @tripflix/core-api test:int src/modules/content/moderation/application/moderation.int.spec.ts` pass 28/28. Test cascade xác nhận bình luận gốc và reply có payload riêng, gồm nội dung, tác giả, ID cha và ID chủ bài. Reply bị ẩn riêng vẫn giữ trạng thái ẩn.
- Kiểm tra trực tiếp schema Zod với payload v1 cũ, payload bình luận gốc và payload reply.
- Kiểm thử end-to-end trên PostgreSQL và Redis 8.8 cô lập. Luồng dùng `ChangeVisibilityUseCase`, `ContentOutboxRelay`, stream `stream:core.content` và `LabelWorker.poll_once()` với classifier ONNX `comment-classifier-v1` đã kiểm tra checksum từ bản phát hành.
- Kịch bản tạo 4 bình luận, ẩn cả 4 rồi khôi phục 3. Event restore khớp payload của từng dòng và không có event cho reply bị ẩn riêng. Sau khi ẩn, Redis xóa nhãn và kết quả an toàn. Sau khi khôi phục, nhãn của bình luận gốc được ghi lại với hash đúng nội dung. Kết quả an toàn của bình luận gốc là `public` và của reply là `pending_review`. Bình luận thường của chủ bài được bộ lọc bỏ qua và nhãn của reply được xử lý ở lượt tóm tắt.
- Sau khi xử lý, số event pending trong group `ai-labels` và số event dead-letter đều bằng 0. Ba event restore được đánh dấu đã phát trong outbox.
- `python -m pytest -q tests/workers/test_label_worker.py tests/workers/test_summary_worker.py` trong repo AI pass 52/52.

## Phạm vi

- Luồng phát sự kiện trong `content/moderation` do Trang phụ trách và schema dùng chung trong `libs/contracts` do Dũng phụ trách. Thay đổi thực hiện theo yêu cầu của Bảo và xác nhận của Trang.
- Kịch bản end-to-end chạy local bằng test fixture tạm trên hai repo và hai container riêng.
