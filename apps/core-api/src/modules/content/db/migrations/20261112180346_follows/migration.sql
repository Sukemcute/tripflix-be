CREATE TABLE "content"."follows" (
	"follower_id" uuid,
	"author_id" uuid,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_follows" PRIMARY KEY("follower_id","author_id"),
	CONSTRAINT "ck_follows_distinct_users" CHECK ("follower_id" <> "author_id")
);
--> statement-breakpoint
CREATE INDEX "idx_follows_author_follower" ON "content"."follows" ("author_id","follower_id");