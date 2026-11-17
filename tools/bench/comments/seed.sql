-- TF99: dữ liệu thử cho benchmark bình luận. Chỉ chạy trên DB local hoặc DB riêng để đo, không chạy trên staging.
-- Một bài thử của bench-1 kèm 10.000 bình luận của 5 tài khoản bench: 8.000 bình luận gốc, 2.000 trả lời.
-- Thời gian tạo trải đều 30 ngày, có phần micro giây như dữ liệu thật (now() của Postgres).
-- Chạy lại được: xoá dữ liệu thử cũ trước khi tạo.
\set ON_ERROR_STOP on
\set bench_post_id '0000be0c-0000-4000-8000-000000000001'

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM access.users WHERE email LIKE 'bench-_@tripflix.local') < 5 THEN
    RAISE EXCEPTION 'Chưa có đủ 5 tài khoản bench-1..5@tripflix.local: chạy setup-users.mjs trước';
  END IF;
END $$;

DELETE FROM content.comment_reactions
WHERE comment_id IN (SELECT id FROM content.comments WHERE post_id = :'bench_post_id');
DELETE FROM content.comments WHERE post_id = :'bench_post_id';
DELETE FROM content.posts WHERE id = :'bench_post_id';

INSERT INTO content.posts (id, author_id, post_type, title, body, status, visibility, published_at, created_at, updated_at)
SELECT :'bench_post_id', u.id, 'vlog', '[BENCH] Bài thử tải bình luận',
  'Bài dùng cho benchmark TF99. Xoá bằng tools/bench/comments/cleanup.sql.',
  'published', 'public', now() - interval '31 days', now() - interval '31 days', now()
FROM access.users u WHERE u.email = 'bench-1@tripflix.local';

CREATE TEMP TABLE bench_authors ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY email) - 1 AS slot, id
FROM access.users WHERE email LIKE 'bench-_@tripflix.local';

-- 8.000 bình luận gốc.
INSERT INTO content.comments (post_id, author_id, body, created_at, updated_at)
SELECT :'bench_post_id', a.id,
  '[bench] Bình luận số ' || g || ': chỗ này đi mùa nào đẹp nhất vậy mọi người?',
  ts, ts
FROM generate_series(1, 8000) AS g
CROSS JOIN LATERAL (
  SELECT now() - interval '30 days' + g * interval '320 milliseconds' + (random() * 300000)::int * interval '1 microsecond' AS ts
) t
JOIN bench_authors a ON a.slot = g % 5;

-- 2.000 trả lời, rải vào 1.000 bình luận gốc ngẫu nhiên, mỗi trả lời sau bình luận gốc của nó.
INSERT INTO content.comments (post_id, author_id, parent_comment_id, body, created_at, updated_at)
SELECT :'bench_post_id', a.id, p.id,
  '[bench] Trả lời số ' || g || ': mình đi tháng 3, trời mát lắm.',
  p.created_at + (g % 600 + 1) * interval '1 second',
  p.created_at + (g % 600 + 1) * interval '1 second'
FROM generate_series(1, 2000) AS g
JOIN LATERAL (
  SELECT id, created_at FROM content.comments
  WHERE post_id = :'bench_post_id' AND parent_comment_id IS NULL
  ORDER BY id OFFSET (g * 7919) % 1000 LIMIT 1
) p ON true
JOIN bench_authors a ON a.slot = (g + 2) % 5;

UPDATE content.posts
SET comment_count = (SELECT count(*) FROM content.comments WHERE post_id = :'bench_post_id')
WHERE id = :'bench_post_id';

COMMIT;

ANALYZE content.comments;

SELECT 'bench post' AS what, :'bench_post_id'::text AS value
UNION ALL SELECT 'bình luận gốc', count(*)::text FROM content.comments WHERE post_id = :'bench_post_id' AND parent_comment_id IS NULL
UNION ALL SELECT 'trả lời', count(*)::text FROM content.comments WHERE post_id = :'bench_post_id' AND parent_comment_id IS NOT NULL;
