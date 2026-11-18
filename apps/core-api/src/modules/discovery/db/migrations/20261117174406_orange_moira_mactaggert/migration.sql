ALTER TABLE "discovery"."recommend_posts" ADD COLUMN "has_plan" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "discovery"."recommend_algos" SET "post_builder" = 'hot@v2', "updated_at" = now() WHERE "name" IN ('trending', 'for_you');
