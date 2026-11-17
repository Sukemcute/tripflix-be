CREATE SCHEMA IF NOT EXISTS "analytics";
--> statement-breakpoint
CREATE TABLE "analytics"."ai_usage_events" (
	"id" uuid PRIMARY KEY,
	"occurred_at" timestamp with time zone NOT NULL,
	"feature" text NOT NULL,
	"step" text,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision NOT NULL,
	"is_estimated" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_events_occurred_at" ON "analytics"."ai_usage_events" ("occurred_at");