-- TF99: xoá dữ liệu thử của benchmark bình luận: bài thử và mọi bình luận, cảm xúc, outbox của nó.
-- Giữ 5 tài khoản bench-1..5@tripflix.local để lần đo sau dùng lại (không có quyền gì đặc biệt).
\set ON_ERROR_STOP on
\set bench_post_id '0000be0c-0000-4000-8000-000000000001'

BEGIN;
DELETE FROM content.comment_reactions
WHERE comment_id IN (SELECT id FROM content.comments WHERE post_id = :'bench_post_id');
DELETE FROM content.comments WHERE post_id = :'bench_post_id';
DELETE FROM content.posts WHERE id = :'bench_post_id';
-- Sự kiện bình luận do bài đo ghi qua API: chưa relay thì bỏ, đã relay thì để relay tự dọn như mọi sự kiện khác.
DELETE FROM content.outbox_events
WHERE published_at IS NULL AND payload ->> 'postId' = :'bench_post_id';
COMMIT;

SELECT 'còn lại' AS what, count(*) AS comments FROM content.comments WHERE post_id = :'bench_post_id';
