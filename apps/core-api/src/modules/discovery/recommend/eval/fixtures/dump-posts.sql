-- Dump fixture cho bộ đo offline (chỉ chạy trên DB local; đọc content.posts chỉ để lấy dữ liệu mẫu, code của discovery không đọc bảng này).
-- Ra một mảng JSON; định dạng lại mỗi bài một dòng trước khi lưu vào posts-<ngày>.json.
select json_agg(json_build_object(
  'postId', r.post_id, 'authorId', r.author_id, 'postType', r.post_type, 'tags', r.tags, 'placeId', r.place_id,
  'isVerified', r.is_verified, 'hasPlan', r.has_plan,
  'publishedAt', to_char(r.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'title', p.title, 'body', p.body,
  'trip', case when p.trip_attachment is null then null else json_build_object(
     'destinationName', p.trip_attachment->>'destinationName',
     'daysCount', (p.trip_attachment->>'daysCount')::int,
     'estimatedCostPerPerson', (p.trip_attachment->>'estimatedCostPerPerson')::numeric,
     'hotelId', p.trip_attachment->>'hotelId',
     'items', (select coalesce(json_agg(json_build_object('day', (i->>'day')::int, 'location', i->>'location', 'category', i->>'category')), '[]'::json)
               from jsonb_array_elements(coalesce(p.trip_attachment->'items', '[]'::jsonb)) i)) end,
  'hot', s.score, 'completeness', (s.features->>'completeness')::numeric
) order by r.post_id)
from discovery.recommend_posts r
join content.posts p on p.id = r.post_id
left join discovery.recommend_post_scores s on s.post_id = r.post_id and s.builder = 'hot' and s.version = 'v2';
