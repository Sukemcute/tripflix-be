ALTER TABLE "access"."users" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "access"."users" ADD COLUMN "terms_accepted_at" timestamp with time zone;