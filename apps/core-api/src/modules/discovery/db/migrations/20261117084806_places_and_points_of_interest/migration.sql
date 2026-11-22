CREATE TABLE "discovery"."places" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_places_kind" CHECK ("kind" in ('province', 'destination'))
);
--> statement-breakpoint
CREATE TABLE "discovery"."points_of_interest" (
	"id" text PRIMARY KEY,
	"place_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"popularity" real DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"source" text NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_points_of_interest_kind" CHECK ("kind" in ('see', 'food', 'cafe', 'lodging'))
);
--> statement-breakpoint
CREATE INDEX "idx_places_parent_id" ON "discovery"."places" ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_points_of_interest_place_id_kind" ON "discovery"."points_of_interest" ("place_id","kind");--> statement-breakpoint
ALTER TABLE "discovery"."places" ADD CONSTRAINT "fk_places_parent_id" FOREIGN KEY ("parent_id") REFERENCES "discovery"."places"("id");--> statement-breakpoint
ALTER TABLE "discovery"."points_of_interest" ADD CONSTRAINT "fk_points_of_interest_place_id" FOREIGN KEY ("place_id") REFERENCES "discovery"."places"("id");