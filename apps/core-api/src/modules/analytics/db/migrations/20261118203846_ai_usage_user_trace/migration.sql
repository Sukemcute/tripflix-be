ALTER TABLE "analytics"."ai_usage_events" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "analytics"."ai_usage_events" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "analytics"."ai_usage_events" ADD COLUMN "turn_id" uuid;--> statement-breakpoint
ALTER TABLE "analytics"."ai_usage_events" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
CREATE INDEX "idx_ai_usage_events_user_occurred" ON "analytics"."ai_usage_events" ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_events_turn" ON "analytics"."ai_usage_events" ("turn_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_events_conversation_occurred" ON "analytics"."ai_usage_events" ("conversation_id","occurred_at");