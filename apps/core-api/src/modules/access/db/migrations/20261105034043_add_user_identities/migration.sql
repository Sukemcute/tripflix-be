CREATE TABLE "access"."user_identities" (
	"provider" text,
	"subject" text,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_user_identities" PRIMARY KEY("provider","subject"),
	CONSTRAINT "ck_user_identities_provider" CHECK ("provider" in ('google'))
);
--> statement-breakpoint
ALTER TABLE "access"."users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_user_identities_user_id" ON "access"."user_identities" ("user_id");--> statement-breakpoint
ALTER TABLE "access"."user_identities" ADD CONSTRAINT "fk_user_identities_user_id" FOREIGN KEY ("user_id") REFERENCES "access"."users"("id") ON DELETE CASCADE;