CREATE TABLE "analytics"."user_activity_events" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"target_id" uuid,
	"detail" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_user_activity_events_user_occurred" ON "analytics"."user_activity_events" ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_user_activity_events_occurred" ON "analytics"."user_activity_events" ("occurred_at");