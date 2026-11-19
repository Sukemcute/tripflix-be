ALTER TABLE "content"."moderation_parts" ADD COLUMN "retried_by" uuid;--> statement-breakpoint
ALTER TABLE "content"."moderation_parts" ADD COLUMN "retried_at" timestamp with time zone;