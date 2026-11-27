CREATE TABLE "content"."moderation_keyword_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"keyword" varchar(120) NOT NULL,
	"normalized_keyword" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_moderation_keyword_rules_normalized_keyword" ON "content"."moderation_keyword_rules" ("normalized_keyword");