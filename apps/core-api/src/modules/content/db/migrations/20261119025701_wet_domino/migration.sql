SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DROP INDEX "content"."idx_comments_creator_pending";--> statement-breakpoint
CREATE INDEX "idx_comments_creator_pending" ON "content"."comments" ("post_id","created_at" DESC,"id" DESC) WHERE "creator_review" = 'pending' AND "deleted_at" IS NULL;
