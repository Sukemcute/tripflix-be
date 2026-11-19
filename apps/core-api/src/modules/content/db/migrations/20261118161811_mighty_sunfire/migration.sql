CREATE TABLE "content"."moderation_review_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"case_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(24) NOT NULL,
	"lease_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_moderation_review_audit_action" CHECK ("action" IN ('claim', 'renew', 'release', 'evidence_view'))
);
--> statement-breakpoint
ALTER TABLE "content"."moderation_cases" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "content"."moderation_cases" ADD COLUMN "lease_id" uuid;--> statement-breakpoint
ALTER TABLE "content"."moderation_cases" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content"."moderation_cases" ADD COLUMN "due_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_moderation_cases_due" ON "content"."moderation_cases" ("due_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_moderation_cases_assignee" ON "content"."moderation_cases" ("assignee_id","lease_expires_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_moderation_review_audit_case" ON "content"."moderation_review_audit" ("case_id","created_at");--> statement-breakpoint
ALTER TABLE "content"."moderation_review_audit" ADD CONSTRAINT "moderation_review_audit_case_id_moderation_cases_id_fkey" FOREIGN KEY ("case_id") REFERENCES "content"."moderation_cases"("id") ON DELETE CASCADE;
--> statement-breakpoint
UPDATE "content"."moderation_cases"
SET "due_at" = "created_at" + CASE WHEN "severity" >= 80 THEN interval '1 hour' ELSE interval '24 hours' END;
