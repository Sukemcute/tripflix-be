ALTER TABLE "content"."reports" RENAME CONSTRAINT "reports_case_id_moderation_cases_id_fkey" TO "fk_reports_case_id";--> statement-breakpoint
ALTER TABLE "content"."comments" ADD CONSTRAINT "ck_comments_status" CHECK ("status" IN ('visible', 'hidden', 'removed'));--> statement-breakpoint
ALTER TABLE "content"."moderation_cases" ADD CONSTRAINT "ck_moderation_cases_target_type" CHECK ("target_type" IN ('post', 'comment'));--> statement-breakpoint
ALTER TABLE "content"."moderation_cases" ADD CONSTRAINT "ck_moderation_cases_status" CHECK ("status" IN ('pending', 'resolved'));--> statement-breakpoint
ALTER TABLE "content"."moderation_cases" ADD CONSTRAINT "ck_moderation_cases_severity" CHECK ("severity" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "content"."reports" ADD CONSTRAINT "ck_reports_target_type" CHECK ("target_type" IN ('post', 'comment'));