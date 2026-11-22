CREATE SCHEMA IF NOT EXISTS "access";
--> statement-breakpoint
CREATE TABLE "access"."audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "access"."audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"ip" text,
	"user_agent" text,
	"meta" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL CONSTRAINT "uq_sessions_refresh_token_hash" UNIQUE,
	"previous_token_hash" text,
	"rotated_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"device_name" text,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL CONSTRAINT "uq_users_email" UNIQUE,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_users_role" CHECK ("role" in ('member', 'moderator', 'superadmin')),
	CONSTRAINT "ck_users_status" CHECK ("status" in ('active', 'locked')),
	CONSTRAINT "ck_users_email_lowercase" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
CREATE INDEX "idx_audit_logs_actor_user_id_created_at" ON "access"."audit_logs" ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_previous_token_hash" ON "access"."sessions" ("previous_token_hash");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "access"."sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires_at" ON "access"."sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "access"."users" ("role") WHERE "role" <> 'member';--> statement-breakpoint
ALTER TABLE "access"."sessions" ADD CONSTRAINT "fk_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "access"."users"("id") ON DELETE CASCADE;