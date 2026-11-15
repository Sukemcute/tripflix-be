ALTER TABLE "content"."moderation_scans" ADD COLUMN "policy_version" text;--> statement-breakpoint
ALTER TABLE "content"."moderation_scans" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "content"."moderation_scans" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content"."moderation_scans" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."moderation_scans" DROP CONSTRAINT "ck_moderation_scans_status", ADD CONSTRAINT "ck_moderation_scans_status" CHECK ("status" IN ('deferred', 'passed', 'flagged', 'failed', 'superseded'));