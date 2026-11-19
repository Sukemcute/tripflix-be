CREATE TABLE "content"."moderation_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"post_id" uuid NOT NULL,
	"content_version" text NOT NULL,
	"part_key" text NOT NULL,
	"kind" varchar(10) NOT NULL,
	"asset_id" uuid,
	"input_hash" text NOT NULL,
	"policy_version" text NOT NULL,
	"status" varchar(20) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"verdict" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_moderation_parts_kind" CHECK ("kind" IN ('caption', 'image')),
	CONSTRAINT "ck_moderation_parts_status" CHECK ("status" IN ('pending','checking','waiting','deferred','passed','flagged','failed','not_applicable','superseded')),
	CONSTRAINT "ck_moderation_parts_attempts" CHECK ("attempts" BETWEEN 0 AND 8)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_moderation_parts_input" ON "content"."moderation_parts" ("post_id","content_version","part_key","input_hash","policy_version");--> statement-breakpoint
CREATE INDEX "idx_moderation_parts_post" ON "content"."moderation_parts" ("post_id","content_version");--> statement-breakpoint
CREATE INDEX "idx_moderation_parts_due" ON "content"."moderation_parts" ("next_attempt_at") WHERE "status" IN ('pending', 'waiting', 'deferred', 'checking');--> statement-breakpoint
ALTER TABLE "content"."moderation_parts" ADD CONSTRAINT "moderation_parts_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE CASCADE;