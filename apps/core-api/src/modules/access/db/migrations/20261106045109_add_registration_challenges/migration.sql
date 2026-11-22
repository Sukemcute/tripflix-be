CREATE TABLE "access"."registration_challenges" (
	"email" text PRIMARY KEY,
	"id" uuid NOT NULL CONSTRAINT "uq_registration_challenges_id" UNIQUE,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_registration_challenges_expires_at" ON "access"."registration_challenges" ("expires_at");