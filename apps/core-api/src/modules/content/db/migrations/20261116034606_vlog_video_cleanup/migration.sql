-- TF25: gỡ video khỏi bài viết (vlog) cũ, lỡ kèm video từ trước khi tách Reels và Bài viết.
-- Video của các bài này không lên Reels (feed chỉ lấy post_type = 'video') và web cũng không hiện;
-- bản nháp thì không lưu hay đăng được vì bài viết cấm video. Bài vẫn là bài viết, giữ lộ trình.
-- Giữ ảnh và id không tra được theo thứ tự cũ; ảnh bìa trỏ vào video thì bỏ.
-- media_ids lỡ lưu dạng chuỗi (một id) được coi như mảng một phần tử.
WITH vlog_media AS (
  SELECT
    p.id,
    CASE jsonb_typeof(p.media_ids)
      WHEN 'array' THEN p.media_ids
      WHEN 'string' THEN jsonb_build_array(p.media_ids)
      ELSE '[]'::jsonb
    END AS ids
  FROM "content"."posts" p
  WHERE p.post_type = 'vlog' AND p.status <> 'deleted'
),
media_items AS (
  SELECT v.id AS post_id, item.media_id, item.ord, m.kind
  FROM vlog_media v
  CROSS JOIN LATERAL jsonb_array_elements_text(v.ids) WITH ORDINALITY AS item(media_id, ord)
  LEFT JOIN "content"."media_assets" m ON m.id = (
    CASE
      WHEN item.media_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN item.media_id::uuid
    END
  )
),
affected AS (
  SELECT
    post_id,
    COALESCE(
      jsonb_agg(to_jsonb(media_id) ORDER BY ord) FILTER (WHERE kind IS DISTINCT FROM 'video'),
      '[]'::jsonb
    ) AS kept_media_ids
  FROM media_items
  GROUP BY post_id
  HAVING count(*) FILTER (WHERE kind = 'video') > 0
)
UPDATE "content"."posts" p
SET
  media_ids = a.kept_media_ids,
  cover_media_id = CASE WHEN a.kept_media_ids ? p.cover_media_id::text THEN p.cover_media_id END,
  updated_at = now()
FROM affected a
WHERE p.id = a.post_id;
