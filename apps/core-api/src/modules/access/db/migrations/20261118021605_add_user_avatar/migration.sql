ALTER TABLE "access"."users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "access"."users" ADD COLUMN "avatar_source" text;--> statement-breakpoint
ALTER TABLE "access"."users" ADD CONSTRAINT "ck_users_avatar_source" CHECK ("avatar_source" is null or "avatar_source" in ('upload', 'google', 'none'));