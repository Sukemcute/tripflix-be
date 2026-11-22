ALTER TABLE "content"."comments" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
UPDATE "content"."comments" SET "published_at" = "created_at" WHERE "status" IN ('visible', 'hidden', 'removed') OR ("status" = 'held' AND "hidden_by_action_id" IS NOT NULL);
