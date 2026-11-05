CREATE TABLE "content"."post_summaries" (
	"post_id" uuid PRIMARY KEY,
	"status" varchar(32) DEFAULT 'ready' NOT NULL,
	"summary" text,
	"key_takeaways" jsonb DEFAULT '[]' NOT NULL,
	"content" jsonb,
	"safety" jsonb,
	"input_hash" varchar(128),
	"comment_count_at_summary" integer DEFAULT 0 NOT NULL,
	"prompt_version" varchar(32),
	"model_name" varchar(64),
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ADD CONSTRAINT "fk_post_summaries_post_id" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE CASCADE;