-- TF99: dọn mọi dữ liệu do 5 tài khoản bench tạo ra khi đo tải (dùng cho staging, chạy được cả local).
-- Chỉ xoá theo id của tài khoản bench và các bài, bình luận do chúng tạo; không đụng dữ liệu của người khác,
-- trừ bình luận và cảm xúc người khác để lại trên bài của bench (bài thử bị xoá thì chúng không còn chỗ hiện).
-- Giữ 5 tài khoản (không có quyền gì đặc biệt) để lần đo sau dùng lại; muốn xoá hẳn thì xem cuối file.
--
-- Chạy (người có quyền ghi DB, sau khi dump):
--   psql -d core -v bench_emails="'bench-1@...','bench-2@...'" -f cleanup-bench-users.sql
-- Mặc định là chạy thử: in số dòng sẽ xoá rồi ROLLBACK. Muốn xoá thật thì thêm -v apply=1.
\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

BEGIN;

CREATE TEMP TABLE bench_users ON COMMIT DROP AS
  SELECT id FROM access.users WHERE email IN (:bench_emails);
CREATE TEMP TABLE bench_posts ON COMMIT DROP AS
  SELECT id FROM content.posts WHERE author_id IN (SELECT id FROM bench_users);
-- Bình luận của bench ở bất kỳ bài nào, cộng mọi bình luận nằm trên bài của bench.
CREATE TEMP TABLE bench_comments ON COMMIT DROP AS
  SELECT id FROM content.comments
  WHERE author_id IN (SELECT id FROM bench_users) OR post_id IN (SELECT id FROM bench_posts);

-- Dừng nếu danh sách email không khớp đúng 5 tài khoản: tránh xoá nhầm khi gõ sai email.
DO $$
BEGIN
  IF (SELECT count(*) FROM bench_users) <> 5 THEN
    RAISE EXCEPTION 'Cần đúng 5 tài khoản bench, tìm thấy %', (SELECT count(*) FROM bench_users);
  END IF;
END $$;

SELECT 'bench_users' AS what, count(*) FROM bench_users
UNION ALL SELECT 'bench_posts', count(*) FROM bench_posts
UNION ALL SELECT 'bench_comments', count(*) FROM bench_comments;

-- Kiểm duyệt (của Trang): lượt quét và hàng chờ quét lại của bình luận, bài bench. Phải xoá trước khi bật lại
-- kiểm duyệt, nếu không các lượt chờ thử lại sẽ gửi bình luận thử sang OpenAI.
DELETE FROM content.moderation_scans
WHERE target_id IN (SELECT id FROM bench_comments) OR target_id IN (SELECT id FROM bench_posts);
-- Khiếu nại trỏ tới quyết định kiểm duyệt (khoá ngoại không cascade): xoá trước các quyết định và bài.
DELETE FROM content.moderation_appeals
WHERE author_id IN (SELECT id FROM bench_users)
   OR decision_id IN (SELECT id FROM content.moderation_actions
                      WHERE comment_id IN (SELECT id FROM bench_comments) OR post_id IN (SELECT id FROM bench_posts));
DELETE FROM content.moderation_actions WHERE comment_id IN (SELECT id FROM bench_comments);
DELETE FROM content.reports
WHERE target_id IN (SELECT id FROM bench_comments) OR target_id IN (SELECT id FROM bench_posts)
   OR reporter_id IN (SELECT id FROM bench_users);
DELETE FROM content.moderation_cases
WHERE target_id IN (SELECT id FROM bench_comments) OR post_id IN (SELECT id FROM bench_posts)
   OR author_id IN (SELECT id FROM bench_users);

-- Sự kiện chưa gửi của bench; sự kiện đã gửi để relay tự dọn như mọi sự kiện khác.
DELETE FROM content.outbox_events
WHERE published_at IS NULL
  AND (user_id IN (SELECT id FROM bench_users)
       OR payload ->> 'postId' IN (SELECT id::text FROM bench_posts)
       OR payload ->> 'commentId' IN (SELECT id::text FROM bench_comments));

-- Nội dung. Xoá bài thì bình luận, cảm xúc, lưu, đếm tạm, tóm tắt, điểm hot, phần kiểm duyệt của bài tự xoá theo (cascade).
DELETE FROM content.comment_reactions WHERE user_id IN (SELECT id FROM bench_users);
DELETE FROM content.reactions WHERE user_id IN (SELECT id FROM bench_users);
DELETE FROM content.bookmarks WHERE user_id IN (SELECT id FROM bench_users);
DELETE FROM content.follows WHERE follower_id IN (SELECT id FROM bench_users) OR author_id IN (SELECT id FROM bench_users);
DELETE FROM content.comments WHERE id IN (SELECT id FROM bench_comments);
DELETE FROM content.posts WHERE id IN (SELECT id FROM bench_posts);

-- Gợi ý (của Duy): tương tác thô làm job dựng đặc trưng chạy rất lâu, nên phải xoá.
DELETE FROM discovery.recommend_interactions
WHERE actor_id IN (SELECT id::text FROM bench_users) OR target_id IN (SELECT id::text FROM bench_posts);
DELETE FROM discovery.recommend_user_features WHERE user_id IN (SELECT id FROM bench_users);
DELETE FROM discovery.recommend_post_scores WHERE post_id IN (SELECT id FROM bench_posts);
DELETE FROM discovery.recommend_posts WHERE post_id IN (SELECT id FROM bench_posts);

-- Thống kê (của Trang).
DELETE FROM analytics.user_activity_events
WHERE user_id IN (SELECT id FROM bench_users) OR target_id IN (SELECT id FROM bench_posts);

-- Phiên đăng nhập của bench (mỗi lần đo đăng nhập lại).
DELETE FROM access.sessions WHERE user_id IN (SELECT id FROM bench_users);

SELECT CASE WHEN :apply = 1 THEN 'Đã xoá' ELSE 'Chạy thử, sẽ ROLLBACK' END AS result;
\if :apply
COMMIT;
\else
ROLLBACK;
\endif

-- Xoá hẳn 5 tài khoản (sau khi chạy phần trên với apply=1), nếu không cần dùng lại:
--   DELETE FROM access.users WHERE email IN (...);
