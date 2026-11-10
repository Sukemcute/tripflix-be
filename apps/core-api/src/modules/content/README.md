# Module `content`

- Chủ: Phong (feed, media), Thành (social), Trang (moderation)
- Database: `core`, schema `content`, user Postgres `tf_content`
- Bảng chính: `posts`, `comments`, `reactions`, `bookmarks`, `media_assets`, `renditions`, `reports`, `moderation_cases`, `moderation_actions`. Feed tính hot từ bộ đếm bài, không có `trend_scores`.

## Phần con

- social: bài, bình luận, thích, theo dõi, lưu (Thành)
- media: upload nhiều phần, bản HLS, ảnh bìa (Phong)
- feed: điểm xu hướng, bảng tin (Phong)
- moderation: luật, báo cáo, hàng chờ (Trang)

### Kiểm duyệt TF32

- `ModerationModule`: API báo cáo và hàng chờ quản trị; consumer group `core-moderation` chỉ chạy với `APP_ROLE=worker|all`.
- Luật chạy trong core; AI gọi nội bộ `${AI_SERVICE_URL}/moderate`, lấy token qua `${CORE_API_INTERNAL_URL}/api/auth/service-token`. Cấp client `core-api ai-service` một lần mỗi môi trường; secret đặt ở `MODERATION_SERVICE_CLIENT_SECRET`.
- AI chạy trước transaction. Pha ghi khoá bài, loại sự kiện trùng, cập nhật case/status/counter/audit và outbox trong một transaction. Lỗi AI dùng regex; lỗi DB/outbox được ném ra để giao lại.
- Ẩn gốc cascade các phản hồi visible; restore chỉ các phản hồi mang đúng lần ẩn cascade, chưa xoá và chưa bị ẩn riêng. Thêm, xoá, ẩn bình luận cùng khoá bài để không lệch counter.
- `POST /api/v1/posts/:id/reports`, `/comments/:id/reports`; `GET /api/v1/admin/moderation/queue`, `/queue/:id`, `/actions`; `POST /queue/:id/decisions`, `/comments/:id/actions`. Các POST mới bắt buộc `Idempotency-Key`; API quản trị chỉ moderator/superadmin.
- `sourceCommentIds` nhận ở PUT summary, trả nguyên metadata ở GET. null là chưa biết nguồn, [] là không dùng bình luận. GET giữ lại văn bản khi nguồn không còn visible; không chờ AI để loại nội dung đã ẩn.

Các phần con dùng chung schema `content`, được join và đặt khoá ngoại với nhau. Migration của schema này cần cả Phong, Thành, Trang duyệt.

## Khuôn thư mục

Mỗi phần con (`social/`, `media/`, `feed/`, `moderation/`) chia:

```
<phần-con>/
├─ api/           # controller, DTO; không mở transaction
├─ application/   # use case, @Transactional('content'), ghi outbox
├─ domain/        # quy tắc nghiệp vụ thuần, không import @nestjs/* hay drizzle-orm
├─ infra/         # repository Drizzle, client dịch vụ ngoài
├─ consumers/     # nghe sự kiện (chỉ chạy khi APP_ROLE là worker hoặc all)
└─ jobs/          # job định kỳ (như trên)
```

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate content`. Không sửa migration đã merge.
