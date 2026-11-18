ALTER TABLE "content"."comments" ADD COLUMN "reply_to_comment_id" uuid;--> statement-breakpoint
ALTER TABLE "content"."comments" ADD COLUMN "author_display_name" text;--> statement-breakpoint
CREATE INDEX "idx_comments_creator_pending" ON "content"."comments" ("post_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "creator_review" = 'pending' AND "deleted_at" IS NULL;