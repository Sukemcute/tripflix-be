# Module `content`

- Chủ: Phong (feed, media), Thành (social), Trang (moderation)
- Database: `core`, schema `content`, user Postgres `tf_content`
- Bảng chính dự kiến: `posts`, `comments`, `reactions`, `follows`, `media_assets`, `renditions`, `trend_scores`, `reports`, `moderation_actions`

## Phần con

- social: bài, bình luận, thích, theo dõi, lưu (Thành)
- media: upload nhiều phần, bản HLS, ảnh bìa (Phong)
- feed: điểm xu hướng, bảng tin (Phong)
- moderation: luật, báo cáo, hàng chờ (Trang)

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
