ALTER TABLE "access"."users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "access"."users" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "access"."users" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "access"."users" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "access"."users" ADD CONSTRAINT "ck_users_gender" CHECK ("gender" is null or "gender" in ('male', 'female', 'other'));--> statement-breakpoint
ALTER TABLE "access"."users" ADD CONSTRAINT "ck_users_nationality" CHECK ("nationality" is null or "nationality" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "access"."users" ADD CONSTRAINT "ck_users_phone" CHECK ("phone" is null or "phone" ~ '^[+]?[0-9]{8,15}$');