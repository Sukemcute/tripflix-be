# Social & Content — Chi tiết Thiết kế API Endpoints (v2.0)

> **Người phụ trách:** Lê Quang Thành (Module Social & Content)  
> **Dự án:** Tripflix (OTA Monorepo) · `tripflix-be` (Core API - NestJS 12 + Drizzle ORM)  
> **Tài liệu căn cứ:** [05-prd-tripflix-v3.md](../../../../05-prd-tripflix-v3.md) · [RULES.md](../../RULES.md) · Bản phác thảo gốc [social_and_content_api-endpoints_FR_ThanhLe.md](../../../../social_and_content_api-endpoints_FR_ThanhLe.md)

---

## 1. Bảng tổng hợp API Endpoints

Hệ thống API phục vụ toàn bộ 13 Functional Requirements (FR), bao gồm 17 API ban đầu của Thành và 3 API đề xuất bổ sung (Bookmark, Share Tracker) để hoàn thiện 100% đặc tả PRD v3:

| # | Phương thức | Endpoint | Mô tả nghiệp vụ | Quyền truy cập | FR Mapping |
|---|---|---|---|---|---|
| **I. Quản lý Bài đăng (Posts & Drafts)** |
| 1 | `POST` | `/v1/posts` | Tạo bản nháp bài đăng | `member` | FR 1, 2, 3 |
| 2 | `PATCH` | `/v1/posts/{post_id}` | Chỉnh sửa bản nháp hoặc bài đã đăng | Tác giả bài viết | FR 1, 5, 7 |
| 3 | `POST` | `/v1/posts/{post_id}/publish` | Xuất bản bài đăng (xét duyệt nhãn "Đã xác thực") | Tác giả bài viết | FR 2, 3 |
| 4 | `DELETE` | `/v1/posts/{post_id}` | Xóa mềm bài đăng của mình | Tác giả bài viết | FR 6 |
| 5 | `GET` | `/v1/posts/{post_id}` | Chi tiết bài đăng theo quyền người xem (kèm dữ liệu lộ trình ẩn danh) | Công khai / Member | FR 3, 4, 12 |
| 6 | `GET` | `/v1/posts` | Bảng tin công khai và tìm kiếm (hỗ trợ Keyset Cursor) | Công khai | FR 2, 4 |
| 7 | `GET` | `/v1/me/posts` | Danh sách bài đăng & bản nháp của người dùng hiện tại | `member` | FR 1 |
| **II. Tương tác Cảm xúc & Thống kê (Reactions & Stats)** |
| 8 | `PUT` | `/v1/posts/{post_id}/reaction` | Thả, đổi hoặc hủy cảm xúc (Idempotent) | `member` | FR 10 |
| 9 | `GET` | `/v1/posts/{post_id}/reaction` | Lấy cảm xúc hiện tại của người dùng đối với bài | `member` | FR 10 |
| 10 | `GET` | `/v1/posts/{post_id}/stats` | Lấy thống kê tương tác tổng hợp (like, comment, share, save) | Công khai | FR 10 |
| **III. Bình luận (Comments)** |
| 11 | `POST` | `/v1/posts/{post_id}/comments` | Tạo bình luận (hỗ trợ phân cấp 1-level reply & chống trùng) | `member` | FR 11 |
| 12 | `GET` | `/v1/posts/{post_id}/comments` | Danh sách bình luận theo phân trang Cursor | Công khai | FR 11 |
| 13 | `PATCH` | `/v1/comments/{comment_id}` | Sửa bình luận của mình | Tác giả bình luận | FR 11 |
| 14 | `DELETE` | `/v1/comments/{comment_id}` | Xóa bình luận của mình | Tác giả bình luận | FR 11 |
| **IV. Lưu bài viết & Chia sẻ (Bookmarks & Shares - Mở rộng)** |
| 15 | `PUT` | `/v1/posts/{post_id}/bookmark` | Đánh dấu lưu hoặc bỏ lưu bài viết | `member` | PRD F3 |
| 16 | `GET` | `/v1/me/bookmarks` | Lấy danh sách bài viết đã lưu để xem offline | `member` | PRD F3 |
| 17 | `POST` | `/v1/posts/{post_id}/shares` | Ghi nhận sự kiện chia sẻ và lấy deep link | Công khai / Member | FR 12, PRD F11 |
| **V. Quản trị & Kiểm duyệt (Admin Moderation - Phối hợp Trang)** |
| 18 | `GET` | `/v1/admin/posts` | Danh sách bài viết trong hàng đợi quản trị | `moderator`, `superadmin` | FR 13 |
| 19 | `GET` | `/v1/admin/posts/{post_id}` | Chi tiết bài viết cho kiểm duyệt kèm nhật ký xử lý | `moderator`, `superadmin` | FR 13 |
| 20 | `POST` | `/v1/admin/posts/{post_id}/moderation-actions` | Thực thi kiểm duyệt (Tạm ẩn, Gỡ, Khôi phục) | `moderator`, `superadmin` | FR 13 |

---

## 2. Chi tiết từng API Endpoint

### I. Quản lý Bài đăng (Posts & Drafts)

#### 1. `POST /v1/posts` — Tạo bản nháp bài đăng
- **Mục đích:** Khởi tạo bản nháp bài viết mới (video dọc hoặc vlog ảnh + chữ) trước khi đính kèm media và xuất bản.
- **Headers:**
  - `Authorization: Bearer <jwt_token>` (Bắt buộc)
  - `Idempotency-Key: <uuid>` (Khuyến nghị cho Mobile khi mạng yếu)
- **Request Body (`CreatePostDto`):**
  ```json
  {
    "post_type": "video", // "video" | "vlog"
    "title": "Kinh nghiệm du lịch Phú Quốc 3N2Đ cùng hội bạn thân",
    "body": "Phú Quốc mùa này biển êm, nước trong vắt. Chi phí cả chuyến chỉ tầm 3 củ rưỡi/người...",
    "hashtags": ["phuquoc", "travel", "vinpearl", "checkin"],
    "visibility": "public", // "public" | "private"
    "media_ids": ["018d9f10-1234-7000-8000-000000000001"],
    "cover_media_id": "018d9f10-1234-7000-8000-000000000001",
    "trip_attachment": {
      "booking_id": "018d9f10-book-7000-8000-000000000099", // Tuỳ chọn: ID đơn đặt đã đi trong "Chuyến đi của tôi"
      "destination_name": "Phú Quốc, Kiên Giang",
      "hotel_name": "Vinpearl Resort & Spa Phú Quốc",
      "hotel_id": "018d9f10-prop-7000-8000-000000000010",
      "days_count": 3,
      "estimated_cost_per_person": 3500000,
      "items": [
        {
          "day": 1,
          "title": "Check-in khách sạn & Ngắm hoàng hôn Sunset Sanato",
          "location": "Bãi Dài, Gành Dầu, Phú Quốc",
          "notes": "Nên đi tầm 16:30 để kịp bắt khoảnh khắc hoàng hôn đẹp nhất."
        },
        {
          "day": 2,
          "title": "Vui chơi thả ga tại VinWonders & Grand World",
          "location": "Bắc đảo Phú Quốc"
        }
      ]
    }
  }
  ```
- **Response Body (201 Created):**
  ```json
  {
    "id": "018d9f20-post-7000-8000-000000000001",
    "author_id": "018d9f00-user-7000-8000-000000000001",
    "post_type": "video",
    "title": "Kinh nghiệm du lịch Phú Quốc 3N2Đ cùng hội bạn thân",
    "body": "Phú Quốc mùa này biển êm...",
    "hashtags": ["phuquoc", "travel", "vinpearl", "checkin"],
    "status": "draft",
    "visibility": "public",
    "is_verified": false,
    "media_ids": ["018d9f10-1234-7000-8000-000000000001"],
    "cover_media_id": "018d9f10-1234-7000-8000-000000000001",
    "trip_attachment": {
      "destination_name": "Phú Quốc, Kiên Giang",
      "hotel_name": "Vinpearl Resort & Spa Phú Quốc",
      "days_count": 3,
      "estimated_cost_per_person": 3500000,
      "price_disclaimer": "Giá chỉ mang tính chất tham khảo",
      "items": [ ... ]
    },
    "created_at": "2026-11-04T08:00:00.000Z",
    "updated_at": "2026-11-04T08:00:00.000Z"
  }
  ```

---

#### 2. `PATCH /v1/posts/{post_id}` — Chỉnh sửa bài đăng hoặc bản nháp
- **Mục đích:** Cập nhật nội dung bài viết nháp hoặc bài đã xuất bản, bao gồm chuyển đổi quyền riêng tư (`public` / `private`).
- **Path Params:** `post_id: string (UUID)`
- **Request Body (`UpdatePostDto`):** Mọi trường đều là optional.
  ```json
  {
    "title": "Tiêu đề mới...",
    "body": "Nội dung cập nhật...",
    "hashtags": ["phuquoc2026"],
    "visibility": "private", // Đổi giữa public và private (FR 7)
    "trip_attachment": { ... }
  }
  ```
- **Quy tắc & Lỗi:**
  - `403 Forbidden`: Người dùng hiện tại không phải là tác giả bài viết.
  - `404 Not Found`: Không tìm thấy bài hoặc bài đã bị xóa mềm.
  - Khi bài đã ở trạng thái `published` và nội dung chữ/ảnh bị sửa đáng kể: Kích hoạt kiểm duyệt ngầm (moderation triage).
- **Response Body (200 OK):** Trả về đối tượng `Post` đầy đủ sau khi cập nhật.

---

#### 3. `POST /v1/posts/{post_id}/publish` — Xuất bản bài đăng
- **Mục đích:** Chuyển bản nháp sang công khai sau khi upload xong media và hoàn thiện nội dung.
- **Path Params:** `post_id: string (UUID)`
- **Nghiệp vụ cốt lõi:**
  1. **Xác thực quyền tác giả:** `post.author_id === currentUser.id`.
  2. **Kiểm tra trạng thái:** Bài phải đang ở trạng thái `draft`.
  3. **Kiểm duyệt sơ bộ (Automated Filter):** Quét từ khóa cấm, số tài khoản, link scam. Nếu vi phạm nghiêm trọng thì từ chối hoặc chuyển hàng đợi kiểm duyệt.
  4. **Quy tắc Dấu "ĐÃ XÁC THỰC" (Verified Badge - F2/FR3):**
     - Nếu bài đính kèm `booking_id`: Hệ thống gọi `commerce.verifyCompletedBooking(bookingId, authorId)`.
     - Nếu đơn hàng đã hoàn tất (đã thanh toán & đã qua ngày trả phòng/sử dụng dịch vụ tại Vinpearl/Khách sạn): Tự động gán `is_verified: true`.
     - Nếu tự tạo hoặc đơn chưa xác thực: `is_verified: false`.
  5. **Chuyển trạng thái:** Cập nhật `status = 'published'`, `published_at = now()`.
  6. **Sinh Deep Link:** `share_url = 'https://tripflix.vn/posts/' + post_id`.
  7. **Outbox Event:** Ghi sự kiện `content.post.published` vào outbox trong cùng transaction để Discovery đánh chỉ mục và Feed tính điểm xu hướng.
- **Response Body (200 OK):**
  ```json
  {
    "id": "018d9f20-post-7000-8000-000000000001",
    "status": "published",
    "is_verified": true,
    "published_at": "2026-11-04T08:15:00.000Z",
    "share_url": "https://tripflix.vn/posts/018d9f20-post-7000-8000-000000000001"
  }
  ```

---

#### 4. `DELETE /v1/posts/{post_id}` — Xóa bài đăng của mình
- **Mục đích:** Xóa mềm bài viết do mình tạo ra.
- **Path Params:** `post_id: string (UUID)`
- **Logic:**
  - Kiểm tra quyền tác giả (hoặc role `superadmin`).
  - Cập nhật `status = 'deleted'`, `deleted_at = now()`.
  - Ghi sự kiện outbox `content.post.deleted` (để Discovery và Feed lập tức gỡ bỏ khỏi kết quả tìm kiếm/bảng tin $\le 3$s).
- **Response Body (200 OK):**
  ```json
  {
    "id": "018d9f20-post-7000-8000-000000000001",
    "deleted": true
  }
  ```

---

#### 5. `GET /v1/posts/{post_id}` — Chi tiết bài đăng theo quyền người xem
- **Mục đích:** Xem chi tiết bài đăng, render video stream HLS, xem lộ trình du lịch kèm giỏ hàng "Đặt y chang" (F5) và ngữ cảnh người xem.
- **Headers:** `Authorization: Bearer <token>` (Tuỳ chọn: Khách vãng lai vẫn xem được bài public).
- **Quy tắc hiển thị (Data Masking & Privacy - PRD F5):**
  - Mọi thông tin cá nhân (họ tên, mã PNR, số điện thoại, giá tiền thanh toán thực tế ban đầu) của tác giả đều bị ẩn.
  - Lộ trình hiển thị giá tham khảo kèm cảnh báo: `"Giá chỉ mang tính chất tham khảo"`.
  - Nếu bài là `private`: Chỉ tác giả hoặc admin mới xem được (người khác nhận `404 Not Found`).
  - Nếu bài là `hidden` hoặc `deleted`: Chỉ moderator/admin xem được.
- **Response Body (200 OK):**
  ```json
  {
    "id": "018d9f20-post-7000-8000-000000000001",
    "author": {
      "id": "018d9f00-user-7000-8000-000000000001",
      "display_name": "Lê Quang Thành",
      "avatar_url": "https://cdn.tripflix.vn/avatars/thanh.jpg",
      "is_verified_creator": true
    },
    "post_type": "video",
    "title": "Kinh nghiệm du lịch Phú Quốc 3N2Đ",
    "body": "Chia sẻ trải nghiệm ăn chơi cực chill...",
    "hashtags": ["phuquoc", "travel", "vinpearl"],
    "status": "published",
    "visibility": "public",
    "is_verified": true,
    "media": [
      {
        "id": "018d9f10-1234-7000-8000-000000000001",
        "type": "video",
        "stream_url": "https://cdn.tripflix.vn/media/video.m3u8",
        "thumbnails": {
          "width_360": "https://cdn.tripflix.vn/media/thumb_360.jpg",
          "width_540": "https://cdn.tripflix.vn/media/thumb_540.jpg",
          "width_720": "https://cdn.tripflix.vn/media/thumb_720.jpg"
        },
        "duration_seconds": 68
      }
    ],
    "trip_attachment": {
      "hotel_id": "018d9f10-prop-7000-8000-000000000010",
      "hotel_name": "Vinpearl Resort & Spa Phú Quốc",
      "destination_name": "Phú Quốc, Kiên Giang",
      "days_count": 3,
      "estimated_cost_per_person": 3500000,
      "price_disclaimer": "Giá chỉ mang tính chất tham khảo",
      "items": [
        {
          "day": 1,
          "title": "Check-in khách sạn & Ngắm hoàng hôn",
          "location": "Bãi Dài, Gành Dầu"
        }
      ]
    },
    "stats": {
      "reaction_counts": { "like": 142, "love": 35, "helpful": 10 },
      "reaction_total": 187,
      "comment_count": 28,
      "share_count": 14,
      "bookmark_count": 45
    },
    "viewer_context": {
      "my_reaction": "like",
      "is_bookmarked": true,
      "is_following_author": false
    },
    "share_url": "https://tripflix.vn/posts/018d9f20-post-7000-8000-000000000001",
    "published_at": "2026-11-04T08:15:00.000Z"
  }
  ```

---

#### 6. `GET /v1/posts` — Danh sách bài đăng công khai (Bảng tin & Tìm kiếm)
- **Mục đích:** Cung cấp nguồn bài viết công khai cho Bảng tin Reels và bộ lọc tìm kiếm.
- **Query Params:**
  - `limit`: number (mặc định: 20, tối đa: 50)
  - `cursor`: string (chuỗi mã hóa timestamp + post_id phục vụ keyset pagination vô tận)
  - `author_id`: string (UUID - lọc theo tác giả)
  - `post_type`: `"video"` | `"vlog"`
  - `hashtag`: string
  - `keyword`: string (tìm kiếm trong tiêu đề và nội dung)
- **Response Body (200 OK):**
  ```json
  {
    "items": [
      {
        "id": "018d9f20-post-7000-8000-000000000001",
        "author": { "id": "...", "display_name": "...", "avatar_url": "..." },
        "post_type": "video",
        "title": "...",
        "status": "published",
        "is_verified": true,
        "cover_media_url": "https://cdn.tripflix.vn/media/thumb_540.jpg",
        "stats": { "reaction_total": 187, "comment_count": 28 },
        "published_at": "2026-11-04T08:15:00.000Z"
      }
    ],
    "next_cursor": "ZXlKaGJHY2lPaUpTVXp...",
    "has_more": true
  }
  ```

---

#### 7. `GET /v1/me/posts` — Danh sách bài đăng và bản nháp của tôi
- **Mục đích:** Hiển thị bài viết trong màn hình Hồ sơ cá nhân (tab Đã đăng và Bản nháp).
- **Headers:** `Authorization: Bearer <jwt_token>` (Bắt buộc)
- **Query Params:**
  - `limit`: number (mặc định: 20)
  - `cursor`: string
  - `status`: `"all"` | `"draft"` | `"published"` (mặc định: `"all"`)
- **Response Body (200 OK):** Danh sách các bài đăng do chính người dùng hiện tại sở hữu.

---

### II. Tương tác Cảm xúc & Thống kê (Reactions & Stats)

#### 8. `PUT /v1/posts/{post_id}/reaction` — Thêm, đổi hoặc bỏ cảm xúc (FR10)
- **Mục đích:** Cung cấp cơ chế thả tim/cảm xúc Idempotent, chống nhảy đúp số lượt thích khi bấm nhiều lần liên tiếp hoặc khi mạng lag gửi lại.
- **Headers:** `Authorization: Bearer <jwt_token>`
- **Path Params:** `post_id: string (UUID)`
- **Request Body (`SetReactionDto`):**
  ```json
  {
    "type": "like" // "like" | "love" | "helpful" | null (truyền null để bỏ cảm xúc)
  }
  ```
- **Xử lý kỹ thuật:**
  - Sử dụng câu lệnh SQL atomic upsert: `INSERT ... ON CONFLICT (user_id, post_id) DO UPDATE SET type = EXCLUDED.type`.
  - Tự động cập nhật bộ đếm trên bảng `posts` bằng SQL: `UPDATE posts SET reaction_counts = ... WHERE id = :post_id`.
  - Ghi sự kiện outbox `content.reaction.updated`.
- **Response Body (200 OK):**
  ```json
  {
    "post_id": "018d9f20-post-7000-8000-000000000001",
    "my_reaction": "like",
    "reaction_counts": {
      "like": 143,
      "love": 35,
      "helpful": 10
    },
    "reaction_total": 188
  }
  ```

---

#### 9. `GET /v1/posts/{post_id}/reaction` — Lấy cảm xúc hiện tại của mình
- **Mục đích:** Kiểm tra người dùng đã thả cảm xúc gì vào bài này chưa.
- **Path Params:** `post_id: string (UUID)`
- **Response Body (200 OK):**
  ```json
  {
    "post_id": "018d9f20-post-7000-8000-000000000001",
    "type": "like" // hoặc null nếu chưa thả
  }
  ```

---

#### 10. `GET /v1/posts/{post_id}/stats` — Thống kê tương tác tổng hợp
- **Mục đích:** Trả về các chỉ số tương tác theo thời gian thực (được tối ưu truy vấn nhanh từ cache/bảng aggregate).
- **Path Params:** `post_id: string (UUID)`
- **Response Body (200 OK):**
  ```json
  {
    "post_id": "018d9f20-post-7000-8000-000000000001",
    "reaction_counts": {
      "like": 143,
      "love": 35,
      "helpful": 10
    },
    "reaction_total": 188,
    "comment_count": 28,
    "share_count": 14,
    "bookmark_count": 45
  }
  ```

---

### III. Bình luận (Comments)

#### 11. `POST /v1/posts/{post_id}/comments` — Tạo bình luận (FR11)
- **Mục đích:** Thêm bình luận mới hoặc phản hồi bình luận của người khác.
- **Headers:**
  - `Authorization: Bearer <jwt_token>`
  - `Idempotency-Key: <uuid>` (Quan trọng khi gửi từ Local Outbox Queue của Mobile lúc có mạng lại)
- **Path Params:** `post_id: string (UUID)`
- **Request Body (`CreateCommentDto`):**
  ```json
  {
    "body": "Chuyến này đi vào tháng mấy thì thời tiết đẹp nhất vậy chủ thớt?",
    "parent_comment_id": null // UUID nếu là trả lời một bình luận khác (hỗ trợ phân cấp 1 cấp)
  }
  ```
- **Xử lý:**
  - Lưu vào bảng `comments`.
  - Tăng atomic counter `comment_count` của bài viết lên 1.
  - Ghi sự kiện outbox `content.comment.created` (phục vụ notification gửi thông báo cho tác giả bài viết).
- **Response Body (201 Created):**
  ```json
  {
    "id": "018d9f30-comm-7000-8000-000000000001",
    "post_id": "018d9f20-post-7000-8000-000000000001",
    "author": {
      "id": "018d9f00-user-7000-8000-000000000001",
      "display_name": "Lê Quang Thành",
      "avatar_url": "https://cdn.tripflix.vn/avatars/thanh.jpg"
    },
    "body": "Chuyến này đi vào tháng mấy...",
    "parent_comment_id": null,
    "created_at": "2026-11-04T08:20:00.000Z"
  }
  ```

---

#### 12. `GET /v1/posts/{post_id}/comments` — Lấy danh sách bình luận (FR11)
- **Path Params:** `post_id: string (UUID)`
- **Query Params:**
  - `limit`: number (mặc định: 20)
  - `cursor`: string
  - `parent_comment_id`: string (nếu muốn tải các phản hồi con của một bình luận cha)
- **Response Body (200 OK):**
  ```json
  {
    "items": [
      {
        "id": "018d9f30-comm-7000-8000-000000000001",
        "author": {
          "id": "018d9f00-user-7000-8000-000000000001",
          "display_name": "Lê Quang Thành",
          "avatar_url": "https://cdn.tripflix.vn/avatars/thanh.jpg"
        },
        "body": "Chuyến này đi vào tháng mấy...",
        "reply_count": 2,
        "is_edited": false,
        "created_at": "2026-11-04T08:20:00.000Z"
      }
    ],
    "next_cursor": null,
    "total": 28
  }
  ```

---

#### 13. `PATCH /v1/comments/{comment_id}` — Chỉnh sửa bình luận của mình
- **Path Params:** `comment_id: string (UUID)`
- **Request Body:** `{ "body": "Nội dung bình luận sau khi đã sửa..." }`
- **Quy tắc:** Chỉ tác giả bình luận mới có quyền sửa.
- **Response Body (200 OK):**
  ```json
  {
    "id": "018d9f30-comm-7000-8000-000000000001",
    "post_id": "018d9f20-post-7000-8000-000000000001",
    "body": "Nội dung bình luận sau khi đã sửa...",
    "is_edited": true,
    "updated_at": "2026-11-04T08:25:00.000Z"
  }
  ```

---

#### 14. `DELETE /v1/comments/{comment_id}` — Xóa bình luận của mình
- **Path Params:** `comment_id: string (UUID)`
- **Logic:** Xóa mềm bình luận và giảm atomic counter `comment_count` của bài viết tương ứng.
- **Response Body (200 OK):**
  ```json
  {
    "id": "018d9f30-comm-7000-8000-000000000001",
    "deleted": true
  }
  ```

---

### IV. Lưu bài viết & Chia sẻ (Bookmarks & Shares)

#### 15. `PUT /v1/posts/{post_id}/bookmark` — Lưu hoặc bỏ lưu bài viết (PRD F3)
- **Mục đích:** Người dùng đánh dấu yêu thích để xem lại sau hoặc truy cập nhanh khi ngoại tuyến (chữ + ảnh bìa).
- **Headers:** `Authorization: Bearer <jwt_token>`
- **Path Params:** `post_id: string (UUID)`
- **Request Body (`SetBookmarkDto`):**
  ```json
  {
    "is_bookmarked": true // true = lưu, false = bỏ lưu
  }
  ```
- **Response Body (200 OK):**
  ```json
  {
    "post_id": "018d9f20-post-7000-8000-000000000001",
    "is_bookmarked": true,
    "bookmark_count": 46
  }
  ```

---

#### 16. `GET /v1/me/bookmarks` — Lấy danh sách bài viết đã lưu
- **Mục đích:** Hiển thị mục "Bài viết đã lưu" trong Hồ sơ cá nhân.
- **Headers:** `Authorization: Bearer <jwt_token>`
- **Query Params:** `limit`, `cursor`
- **Response Body (200 OK):** Danh sách các bài đăng tóm tắt kèm thông tin cache offline.

---

#### 17. `POST /v1/posts/{post_id}/shares` — Ghi nhận lượt chia sẻ bài viết (FR12, PRD F11)
- **Mục đích:** Kích hoạt khi người dùng bấm copy link hoặc chia sẻ ra mạng xã hội ngoài; cập nhật bộ đếm và bắn event cho hệ thống trending.
- **Path Params:** `post_id: string (UUID)`
- **Response Body (200 OK):**
  ```json
  {
    "post_id": "018d9f20-post-7000-8000-000000000001",
    "share_url": "https://tripflix.vn/posts/018d9f20-post-7000-8000-000000000001",
    "share_count": 15
  }
  ```

---

### V. Quản trị & Kiểm duyệt (Admin Moderation)

#### 18. `GET /v1/admin/posts` — Danh sách bài đăng trong trang quản trị (FR13)
- **Quyền:** Role `moderator` hoặc `superadmin`
- **Query Params:**
  - `limit`: number
  - `cursor`: string
  - `status`: `"draft"` | `"published"` | `"hidden"` | `"removed"` | `"flagged"`
  - `author_id`: string
- **Response Body (200 OK):**
  ```json
  {
    "items": [
      {
        "id": "018d9f20-post-7000-8000-000000000001",
        "author": { "id": "...", "display_name": "..." },
        "title": "Kinh nghiệm du lịch...",
        "status": "published",
        "report_count": 0,
        "created_at": "2026-11-04T08:00:00.000Z"
      }
    ],
    "total": 120
  }
  ```

---

#### 19. `GET /v1/admin/posts/{post_id}` — Chi tiết bài đăng kèm lịch sử kiểm duyệt (FR13)
- **Quyền:** `moderator` hoặc `superadmin`
- **Path Params:** `post_id: string (UUID)`
- **Response Body (200 OK):**
  ```json
  {
    "id": "018d9f20-post-7000-8000-000000000001",
    "title": "...",
    "body": "...",
    "status": "hidden",
    "author": { ... },
    "moderation_history": [
      {
        "action_id": "018d9f50-act-7000-8000-000000000005",
        "action": "hide",
        "reason_code": "SPAM_OR_COMMERCIAL",
        "reason_detail": "Spam link mua bán",
        "moderator_id": "018d9f00-mod-7000-8000-000000000009",
        "created_at": "2026-11-04T08:30:00.000Z"
      }
    ]
  }
  ```

---

#### 20. `POST /v1/admin/posts/{post_id}/moderation-actions` — Xử lý kiểm duyệt bài viết (FR13)
- **Quyền:** `moderator` hoặc `superadmin`
- **Path Params:** `post_id: string (UUID)`
- **Request Body (`CreateModerationActionDto`):**
  ```json
  {
    "action": "hide", // "hide" | "remove" | "restore"
    "reason_code": "COMMUNITY_VIOLATION",
    "reason_detail": "Nội dung gây hiểu lầm hoặc vi phạm quy chuẩn",
    "report_ids": ["018d9f40-repo-7000-8000-000000000004"]
  }
  ```
- **Xử lý cốt lõi:**
  - Transaction `@Transactional('content')`:
    - Cập nhật trạng thái `posts.status`:
      - `action === 'hide'` -> `status = 'hidden'`
      - `action === 'remove'` -> `status = 'removed'`
      - `action === 'restore'` -> `status = 'published'`
    - Lưu bản ghi vào bảng `content.moderation_actions`.
    - Ghi sự kiện outbox `content.post.moderated`.
  - Phối hợp với module Discovery và Feed: Bài bị ẩn/gỡ lập tức biến mất khỏi bảng tin và kết quả tìm kiếm trong vòng $\le 3$ giây.
- **Response Body (201 Created):**
  ```json
  {
    "action_id": "018d9f50-act-7000-8000-000000000005",
    "post_id": "018d9f20-post-7000-8000-000000000001",
    "previous_status": "published",
    "post_status": "hidden",
    "moderator_id": "018d9f00-mod-7000-8000-000000000009",
    "created_at": "2026-11-04T08:30:00.000Z"
  }
  ```

---

## 3. Bảng đối chiếu nâng cấp (So sánh với file markdown gốc)

| Tiêu chí | File gốc của Thành (`social_and_content_...`) | Bản chuẩn hóa v2.0 | Lý do nâng cấp |
|---|---|---|---|
| **Số lượng Endpoint** | 17 endpoints | 20 endpoints | Bổ sung Bookmark (PRD F3) và Share tracker (PRD F11) |
| **Cơ chế phân trang** | `limit: int` đơn thuần | Keyset Pagination (`cursor`, `next_cursor`, `limit`) | Cuộn vô tận không bị lặp bài khi có bài mới chèn vào |
| **Xử lý mạng lag/lỗi** | Chưa đề cập ở header API | Bổ sung `Idempotency-Key` ở POST post, comment, reaction | Bảo vệ chống gửi lặp bài/comment khi app tự động retry |
| **Lộ trình đính kèm** | `trip_attachment: object` chung chung | Schema rõ ràng: `hotel_name`, `hotel_id`, `items`, PII Masking | Tuân thủ nghiêm ngặt bảo mật thông tin theo PRD F5 |
| **Dấu "Đã xác thực"** | Chưa định nghĩa luồng gán cờ | Tự động kiểm tra đơn hàng từ module `commerce` khi `publish` | Đảm bảo tính trung thực (F2), người dùng không tự gán cờ |
| **Mã lỗi & Validation** | Chỉ mô tả input text | Định nghĩa cụ thể DTO Zod / NestJS Swagger, HTTP 400, 403, 404 | Chuẩn hóa để Orval sinh ra API client sạch đẹp cho Frontend |
