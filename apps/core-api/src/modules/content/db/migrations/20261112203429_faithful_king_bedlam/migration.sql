ALTER TABLE "content"."moderation_scans" ADD COLUMN "retried_by" uuid;--> statement-breakpoint
ALTER TABLE "content"."moderation_scans" ADD COLUMN "retried_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_reports_reporter_created" ON "content"."reports" ("reporter_id","created_at");--> statement-breakpoint
ALTER TABLE "content"."moderation_appeals" ADD CONSTRAINT "moderation_appeals_decision_id_moderation_actions_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "content"."moderation_actions"("id");