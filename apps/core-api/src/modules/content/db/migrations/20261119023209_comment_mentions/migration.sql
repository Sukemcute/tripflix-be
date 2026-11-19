SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "content"."comments" ADD COLUMN "mentions" jsonb DEFAULT '[]' NOT NULL;
