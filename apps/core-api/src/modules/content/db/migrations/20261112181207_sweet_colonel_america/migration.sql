CREATE TABLE "content"."moderation_scans" (
	"event_id" uuid PRIMARY KEY,
	"target_type" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"content_version" text NOT NULL,
	"status" varchar(20) NOT NULL,
	"model" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_moderation_scans_status" CHECK ("status" IN ('deferred', 'passed', 'flagged'))
);
--> statement-breakpoint
CREATE INDEX "idx_moderation_scans_status" ON "content"."moderation_scans" ("status","updated_at");