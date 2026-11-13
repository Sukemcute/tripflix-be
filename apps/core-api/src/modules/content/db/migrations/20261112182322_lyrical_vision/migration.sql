CREATE TABLE "content"."moderation_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"decision_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "ck_moderation_appeal_status" CHECK ("status" IN ('pending', 'upheld', 'overturned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_moderation_appeal_decision" ON "content"."moderation_appeals" ("decision_id");--> statement-breakpoint
CREATE INDEX "idx_moderation_appeal_queue" ON "content"."moderation_appeals" ("status","created_at");