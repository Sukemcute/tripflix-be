ALTER TABLE "content"."moderation_actions" ADD COLUMN "policy_version" text;--> statement-breakpoint
ALTER TABLE "content"."moderation_actions" ADD COLUMN "evidence_snapshot" jsonb;