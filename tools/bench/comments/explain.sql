-- TF99 · R2: kế hoạch thực thi của các câu mà GET /posts/:id/comments chạy (chép theo comment.repository.ts),
-- trên bài thử 10.000 bình luận. Xem index nào được dùng, đọc bao nhiêu dòng, bao nhiêu trang (buffers).
-- Ngưỡng: mỗi trang đọc ≤ 21 dòng (20 bình luận + 1 dòng để biết còn trang sau).
-- Người xem đăng nhập: bình luận 'held' của chính họ vẫn hiện (readableStatus).
\set bench_post_id '0000be0c-0000-4000-8000-000000000001'
\pset pager off

SELECT id AS viewer_id FROM access.users WHERE email = 'bench-1@tripflix.local' \gset

\echo '== Trang 1 bình luận gốc =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM content.comments
WHERE post_id = :'bench_post_id' AND deleted_at IS NULL
  AND (status = 'visible' OR (status = 'held' AND author_id = :'viewer_id'))
  AND parent_comment_id IS NULL
ORDER BY created_at DESC, id DESC LIMIT 21;

SELECT created_at AS cursor_at, id AS cursor_id FROM content.comments
WHERE post_id = :'bench_post_id' AND deleted_at IS NULL AND status = 'visible' AND parent_comment_id IS NULL
ORDER BY created_at DESC, id DESC OFFSET 7979 LIMIT 1 \gset

\echo '== Trang cuối (400) bình luận gốc, cursor dạng OR: (t < x) OR (t = x AND id < y) =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM content.comments
WHERE post_id = :'bench_post_id' AND deleted_at IS NULL
  AND (status = 'visible' OR (status = 'held' AND author_id = :'viewer_id'))
  AND parent_comment_id IS NULL
  AND (created_at < :'cursor_at' OR (created_at = :'cursor_at' AND id < :'cursor_id'))
ORDER BY created_at DESC, id DESC LIMIT 21;

\echo '== Trang cuối (400) bình luận gốc, cursor dạng cặp: (t, id) < (x, y) =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM content.comments
WHERE post_id = :'bench_post_id' AND deleted_at IS NULL
  AND (status = 'visible' OR (status = 'held' AND author_id = :'viewer_id'))
  AND parent_comment_id IS NULL
  AND (created_at, id) < (:'cursor_at'::timestamptz, :'cursor_id'::uuid)
ORDER BY created_at DESC, id DESC LIMIT 21;

SELECT parent_comment_id AS busy_root_id FROM content.comments
WHERE post_id = :'bench_post_id' AND parent_comment_id IS NOT NULL AND deleted_at IS NULL
GROUP BY parent_comment_id ORDER BY count(*) DESC LIMIT 1 \gset

\echo '== Trang 1 trả lời của bình luận gốc nhiều trả lời nhất =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM content.comments
WHERE post_id = :'bench_post_id' AND deleted_at IS NULL
  AND (status = 'visible' OR (status = 'held' AND author_id = :'viewer_id'))
  AND parent_comment_id = :'busy_root_id'
ORDER BY created_at DESC, id DESC LIMIT 21;

\echo '== Đếm bình luận gốc (chạy ở mọi trang) =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*)::int FROM content.comments
WHERE post_id = :'bench_post_id' AND deleted_at IS NULL
  AND (status = 'visible' OR (status = 'held' AND author_id = :'viewer_id'))
  AND parent_comment_id IS NULL;

\echo '== Đếm trả lời của 20 bình luận trên trang 1 =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT parent_comment_id, count(*)::int FROM content.comments
WHERE parent_comment_id IN (
  SELECT id FROM content.comments
  WHERE post_id = :'bench_post_id' AND parent_comment_id IS NULL AND status = 'visible' AND deleted_at IS NULL
  ORDER BY created_at DESC, id DESC LIMIT 20
) AND deleted_at IS NULL AND status = 'visible'
GROUP BY parent_comment_id;
