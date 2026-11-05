# TF07 — Bộ dữ liệu bài đăng & bình luận mẫu phục vụ Feed, Search và AI Summary

- Task: TF07 (SCRUM-11) · Nhánh: `thanh/TF07-seed-posts-and-comments` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Tạo bộ dữ liệu mẫu JSON chất lượng cao (`posts-seed.json`)**:
  - `apps/core-api/src/modules/content/db/seed/posts-seed.json` chứa đầy đủ dữ liệu cho 5 bảng trong schema `content`:
    - **8 bài đăng mẫu (Posts)**: 5 vlog lộ trình và 3 video ngắn dọc trải dài qua 8 điểm đến du lịch nổi tiếng (Đà Nẵng, Hội An, Phú Quốc, Đà Lạt, Nha Trang, Hạ Long, Sa Pa, Ninh Bình).
    - **Liên kết thực tế với Commerce**: Các bài đăng liên kết chính xác với các khách sạn thật trong seed commerce của Thắng (`P-h-dn-01`, `P-h-ha-01`, `P-h-pq-01`, `P-vn-h-da-lat-1`, `P-h-nt-01`, `P-h-hl-01`, `P-vn-h-lao-cai-1`, `P-vn-h-ninh-binh-1`).
    - **Lộ trình `tripAttachment` & PII Masking**: Lộ trình chi tiết theo từng ngày (Day 1, Day 2, Day 3), chi phí ước tính, đính kèm disclaimer giá và phân định rõ bài có booking xác thực (`isVerified: true`) và chuyến đi tự tạo (`isVerified: false`).
    - **8 Media Assets (`media_assets`)**: Video ở trạng thái `ready` với metadata hợp lệ (tỉ lệ `9:16` hoặc `16:9`, thời lượng 28–48 giây, đường dẫn CloudFront/S3 `dev/phong/videos/...`).
    - **25 Bình luận mẫu (Comments)**: Bao gồm nhiều góc nhìn thực tế (khen cảnh đẹp, hỏi giá phòng, hỏi kinh nghiệm đi lại, phản hồi của tác giả, hỗ trợ 1-level reply). Đây là tập dữ liệu mẫu chuẩn để Bảo (`ai-service`) đưa vào prompt và model test AI Summary.
    - **Tương tác ban đầu**: 10 reactions (`like`, `love`, `helpful`) và 5 bookmarks giúp bài đăng có sẵn điểm tương tác cho thuật toán hiển thị bảng tin của Phong (`feed`).
- **Xây dựng module `seedContent` (`seed-content.ts`)**:
  - `apps/core-api/src/modules/content/db/seed/seed-content.ts` thực thi nạp dữ liệu vào database theo thứ tự quan hệ trong một transaction PostgreSQL duy nhất.
  - Sử dụng cơ chế Idempotent (`onConflictDoUpdate` / `onConflictDoNothing`) với UUID v7/v4 chuẩn hex, đảm bảo chạy lại nhiều lần không sinh trùng dữ liệu và không gây lỗi duplicate key.
- **Tích hợp vào CLI `pnpm db:seed`**:
  - Cập nhật `apps/core-api/src/cli/seed.ts` kết nối tới `DATABASE_URL_CONTENT` và gọi `seedContent(contentDb)`.
  - In thông số chi tiết khi hoàn tất: `content: 8 bài đăng, 25 bình luận, 10 cảm xúc, 5 bookmark, 8 media assets`.
- **Kiểm thử**:
  - Viết unit test `apps/core-api/src/modules/content/db/seed/seed-content.spec.ts` kiểm tra tính toàn vẹn của JSON, tính hợp lệ của UUID/schema, cấu trúc cây comment 1 cấp và mock insert vào database (4/4 tests pass).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Có từ 5–10 bài đăng mẫu có video đẹp, vlog lộ trình đã mask PII | Đạt | 8 bài đăng trong `posts-seed.json` |
| Có tập bình luận mẫu phong phú để AI service test tóm tắt | Đạt | 25 bình luận thực tế (khen, chê, hỏi đáp, reply) trong `posts-seed.json` |
| Tích hợp vào lệnh `pnpm db:seed`, chạy lại không sinh trùng | Đạt | `apps/core-api/src/cli/seed.ts` & `seed-content.ts` |
| Không vi phạm ranh giới module, không lỗi lint/typecheck/test | Đạt | `node tools/check-boundaries.mjs` (0 vi phạm), `pnpm lint` (0 errors), `pnpm typecheck` (pass 100%), `pnpm test` (222/222 tests pass trên core-api) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm lint`: 22 tasks successful, 0 errors.
- `pnpm typecheck`: 22 tasks successful across 13 packages (Pass 100%).
- `pnpm --filter @tripflix/core-api test`: 29 test files pass, 222 tests pass.
- `pnpm contracts:build`: Đã ghi `contracts/openapi/core-api.json`.

## Cách kiểm lại
1. `cd tripflix-be`
2. `node tools/check-boundaries.mjs`
3. `pnpm --filter @tripflix/core-api test -- seed-content.spec.ts`
4. Khi chạy với database thật: `pnpm stack:infra && pnpm db:seed`

## Ảnh hưởng tới phần của người khác
- Giúp mở khóa công việc của cả 3 đồng đội:
  - **Phong (Feed)**: Có bài viết và video mẫu để test giao diện bảng tin và thuật toán phân phối.
  - **Duy (Search)**: Có bài đăng và địa điểm du lịch để test tìm kiếm `/search/posts`.
  - **Bảo (AI)**: Có dữ liệu bình luận mẫu để phát triển tính năng tóm tắt review/bình luận (AI Summary).
