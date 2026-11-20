CREATE TABLE "content"."trend_signals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content"."trend_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"post_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"actor_key" text NOT NULL,
	"is_guest" boolean NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_trend_signals_kind" CHECK ("kind" in ('view', 'booking_click'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_trend_signals_post_kind_actor" ON "content"."trend_signals" ("post_id","kind","actor_key");--> statement-breakpoint
CREATE INDEX "idx_trend_signals_occurred_at" ON "content"."trend_signals" ("occurred_at");--> statement-breakpoint
ALTER TABLE "content"."trend_signals" ADD CONSTRAINT "trend_signals_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE CASCADE;