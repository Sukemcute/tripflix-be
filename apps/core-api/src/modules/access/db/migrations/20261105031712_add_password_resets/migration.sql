CREATE TABLE "access"."password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL CONSTRAINT "uq_password_resets_token_hash" UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_password_resets_user_id" ON "access"."password_resets" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_password_resets_expires_at" ON "access"."password_resets" ("expires_at");--> statement-breakpoint
ALTER TABLE "access"."password_resets" ADD CONSTRAINT "fk_password_resets_user_id" FOREIGN KEY ("user_id") REFERENCES "access"."users"("id") ON DELETE CASCADE;