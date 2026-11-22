CREATE SCHEMA IF NOT EXISTS "discovery";
--> statement-breakpoint
-- Thêm tay: drizzle-kit không sinh extension. pg_trgm là extension "trusted", user tf_discovery tạo được.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA "discovery";
--> statement-breakpoint
CREATE TABLE "discovery"."search_entities" (
	"id" text PRIMARY KEY,
	"type" text NOT NULL,
	"ref_id" text NOT NULL,
	"name" text NOT NULL,
	"subtitle" text,
	"place_id" text,
	"search_text" text NOT NULL,
	"popularity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_search_entities_type" CHECK ("type" in ('place', 'hotel', 'airport'))
);
--> statement-breakpoint
CREATE INDEX "idx_search_entities_search_text" ON "discovery"."search_entities" USING gin ("search_text" gin_trgm_ops);