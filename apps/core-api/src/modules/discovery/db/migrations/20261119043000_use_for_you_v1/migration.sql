-- Bật for-you v1 (TF28 P6): ngăn theo câu hỏi chuyến đi + giai đoạn + nguồn caption e5. trending giữ hot@v2.
-- Quay về v0: UPDATE ... SET post_builder = 'hot@v2', user_builder = 'tag_affinity@v0', ranker = 'tag_affinity_v0' WHERE name = 'for_you'.
UPDATE "discovery"."recommend_algos"
SET "post_builder" = 'post_profile@v1',
    "user_builder" = 'trip_profile@v1',
    "ranker" = 'trip_v1',
    "updated_at" = now()
WHERE "name" = 'for_you';
