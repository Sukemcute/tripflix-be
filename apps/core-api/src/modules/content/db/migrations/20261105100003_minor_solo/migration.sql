CREATE TABLE "content"."comment_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(20) DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content"."comments" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_comment_reactions_comment_user" ON "content"."comment_reactions" ("comment_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_comment_reactions_user_created" ON "content"."comment_reactions" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "content"."comment_reactions" ADD CONSTRAINT "fk_comment_reactions_comment_id" FOREIGN KEY ("comment_id") REFERENCES "content"."comments"("id") ON DELETE CASCADE;