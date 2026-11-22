# TF33 — Bảo vệ endpoint comment-stats và an toàn Regex UUID trong đối soát AI

- Notion: https://notion.so/tripflix/TF33 · Nhánh: `thanh/TF33-bao-ve-comment-stats-va-regex-uuid-doi-soat` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-11

## Bối cảnh & Phản hồi kỹ thuật
Sau khi merge PR #128 (`feat(social): lấy mẫu bình luận ngẫu nhiên và đối soát tóm tắt ai`), Bảo (phụ trách module AI Service) đã tích hợp vào worker và góp ý 2 điểm tối ưu hóa:
1. `GET /api/v1/posts/:postId/comment-stats` đang mở công khai (`@OptionalAuthenticated()`), có nguy cơ bị spam truy vấn nặng `count(distinct author_id)` làm treo DB.
2. Câu query `findHeldSummaryPostIds` ép kiểu trực tiếp `src.id::uuid`. Nếu `source_comment_ids` chứa chuỗi không phải UUID (dữ liệu seed cũ, mock test), Postgres sẽ văng lỗi `invalid input syntax for type uuid`, làm crash endpoint 500 và chặn toàn bộ tiến trình đối soát.
3. Ghi chú về tiềm năng đụng độ hash 32-bit của hàm `hashtext`.

## Đã làm
- **Bảo vệ endpoint `GET /api/v1/posts/:postId/comment-stats`**:
  - Chuyển từ `@OptionalAuthenticated()` sang `@ServiceOnly('ai-service')` và `@ApiBearerAuth()`.
  - Khóa chặt endpoint chỉ cho phép service nội bộ có token hợp lệ gọi.
  - Cập nhật OpenAPI spec phản ánh đúng yêu cầu security bearer và mã lỗi 401/403.
- **An toàn ép kiểu UUID trong câu truy vấn đối soát (`findHeldSummaryPostIds`)**:
  - Bổ sung điều kiện Regex kiểm tra định dạng UUID trước khi cast:
    ```sql
    LEFT JOIN content.comments c
      ON src.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND c.id = src.id::uuid
    ```
  - Triệt tiêu 100% rủi ro crash runtime khi gặp dữ liệu xấu, đồng thời giữ nguyên khả năng tận dụng Primary Key B-Tree Index trên bảng `comments`.
  - Áp dụng kiểm tra an toàn regex tương tự cho param phân trang `cursor`.
- **Loại bỏ nguy cơ đụng độ hash 32-bit (`hashtext`)**:
  - Bổ sung secondary order `comments.id` vào câu lệnh lấy mẫu: `ORDER BY hashtext(comments.id::text || :seed), comments.id` để đảm bảo kết quả deterministic tuyệt đối.
- **Kiểm thử tự động**:
  - Cập nhật unit test trong `comment-sampling-and-reconciliation.spec.ts`.
  - Toàn bộ 79 test suites (2.117 tests) của `core-api` pass 100%.
  - `node tools/check-boundaries.mjs`: Ranh giới module không có vi phạm.

## Kết quả kiểm tra
- `pnpm vitest run "comment-sampling-and-reconciliation"`: 10/10 tests pass.
- `pnpm --filter @tripflix/core-api test`: 79 test files, 2.117 tests pass.
- `node tools/check-boundaries.mjs`: Không có vi phạm.
- `pnpm lint`: 0 errors.
- `nest build`: Build thành công.

## Ảnh hưởng tới phần của người khác
- Không: Đồng bộ với phân hệ AI Service (`tripflix-ai`) của Bảo, đã thống nhất qua trao đổi kỹ thuật.
