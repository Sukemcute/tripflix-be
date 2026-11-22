CREATE SCHEMA IF NOT EXISTS "content";
--> statement-breakpoint
CREATE TABLE "content"."posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"author_id" uuid NOT NULL,
	"post_type" varchar(20) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"hashtags" jsonb DEFAULT '[]' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"visibility" varchar(20) DEFAULT 'public' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"media_ids" jsonb DEFAULT '[]' NOT NULL,
	"cover_media_id" uuid,
	"trip_attachment" jsonb,
	"reaction_counts" jsonb DEFAULT '{}' NOT NULL,
	"reaction_total" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"share_count" integer DEFAULT 0 NOT NULL,
	"bookmark_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content"."comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"body" text NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content"."reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"post_id" uuid NOT NULL,
	"moderator_id" uuid NOT NULL,
	"action" varchar(20) NOT NULL,
	"previous_status" varchar(20) NOT NULL,
	"post_status" varchar(20) NOT NULL,
	"reason_code" varchar(50) NOT NULL,
	"reason_detail" text,
	"report_ids" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_posts_status_visibility_created" ON "content"."posts" ("status","visibility","created_at");--> statement-breakpoint
CREATE INDEX "idx_posts_author_created" ON "content"."posts" ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_posts_author_status" ON "content"."posts" ("author_id","status");--> statement-breakpoint
CREATE INDEX "idx_comments_post_created" ON "content"."comments" ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_comments_parent" ON "content"."comments" ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "idx_comments_author" ON "content"."comments" ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reactions_post_user" ON "content"."reactions" ("post_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_reactions_post_type" ON "content"."reactions" ("post_id","type");--> statement-breakpoint
CREATE INDEX "idx_reactions_user_created" ON "content"."reactions" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bookmarks_post_user" ON "content"."bookmarks" ("post_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_bookmarks_user_created" ON "content"."bookmarks" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_moderation_post_created" ON "content"."moderation_actions" ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_moderation_moderator" ON "content"."moderation_actions" ("moderator_id");--> statement-breakpoint
ALTER TABLE "content"."comments" ADD CONSTRAINT "comments_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content"."reactions" ADD CONSTRAINT "reactions_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content"."bookmarks" ADD CONSTRAINT "bookmarks_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content"."moderation_actions" ADD CONSTRAINT "moderation_actions_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE CASCADE;