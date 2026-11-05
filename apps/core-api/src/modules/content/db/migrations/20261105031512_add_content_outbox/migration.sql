CREATE TABLE "content"."outbox_events" (
	"id" uuid PRIMARY KEY,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"producer" text NOT NULL,
	"payload" jsonb NOT NULL,
	"user_id" uuid,
	"trace_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "idx_outbox_events_unpublished" ON "content"."outbox_events" ("occurred_at") WHERE "published_at" is null;