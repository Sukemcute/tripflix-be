CREATE TABLE "commerce"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_audit_logs_entity_type" CHECK ("entity_type" in ('room_type', 'flight'))
);
--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "commerce"."audit_logs" ("entity_type","entity_id","created_at");