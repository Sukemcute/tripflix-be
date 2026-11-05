CREATE TABLE "content"."post_summaries" (
	"post_id" uuid PRIMARY KEY,
	"summary" text NOT NULL,
	"key_takeaways" jsonb DEFAULT '[]' NOT NULL,
	"input_hash" varchar(128),
	"comment_count_at_summary" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ADD CONSTRAINT "post_summaries_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE CASCADE;