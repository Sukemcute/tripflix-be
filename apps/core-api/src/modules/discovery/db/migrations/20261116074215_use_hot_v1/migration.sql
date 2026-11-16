-- Nâng điểm xu hướng lên hot@v1 (TF23: trọng số tuổi tài khoản + đơn đặt từ bài).
UPDATE "discovery"."recommend_algos"
SET "post_builder" = 'hot@v1',
    "updated_at" = now()
WHERE "name" IN ('trending', 'for_you');
