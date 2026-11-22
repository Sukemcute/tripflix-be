CREATE TABLE "access"."email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL CONSTRAINT "uq_email_verifications_token_hash" UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access"."users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_email_verifications_user_id" ON "access"."email_verifications" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_email_verifications_expires_at" ON "access"."email_verifications" ("expires_at");--> statement-breakpoint
ALTER TABLE "access"."email_verifications" ADD CONSTRAINT "fk_email_verifications_user_id" FOREIGN KEY ("user_id") REFERENCES "access"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
-- TF05D: tài khoản đã liên kết Google có email do Google xác minh, coi là đã xác thực từ lúc liên kết.
-- Tài khoản chỉ có mật khẩu tạo trước TF05D để trống: chủ tài khoản phải bấm link xác thực.
UPDATE "access"."users" AS u SET "email_verified_at" = i."created_at"
FROM (SELECT "user_id", min("created_at") AS "created_at" FROM "access"."user_identities" GROUP BY "user_id") AS i
WHERE u."id" = i."user_id" AND u."email_verified_at" IS NULL;
