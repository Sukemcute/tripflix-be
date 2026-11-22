ALTER TABLE "content"."post_summaries" RENAME CONSTRAINT "post_summaries_post_id_posts_id_fkey" TO "fk_post_summaries_post_id";--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ADD COLUMN "status" varchar(32) DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ADD COLUMN "safety" jsonb;--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ADD COLUMN "prompt_version" varchar(32);--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ADD COLUMN "model_name" varchar(64);--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ADD COLUMN "generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ALTER COLUMN "summary" DROP NOT NULL;