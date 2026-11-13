ALTER TABLE "content"."reports" ADD COLUMN "content_version" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
DROP INDEX "content"."uq_reports_target_reporter";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reports_target_reporter" ON "content"."reports" ("target_type","target_id","content_version","reporter_id");