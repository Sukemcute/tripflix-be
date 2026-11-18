ALTER TABLE "content"."posts" ADD COLUMN "comments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."posts" ADD COLUMN "comment_keywords" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."comments" ADD COLUMN "creator_review" varchar(12) DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."comments" ADD COLUMN "platform_held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "content"."comments" SET "platform_held" = true WHERE "status" = 'held';--> statement-breakpoint
ALTER TABLE "content"."comments" ADD CONSTRAINT "ck_comments_creator_review" CHECK ("creator_review" IN ('approved', 'pending', 'rejected'));
