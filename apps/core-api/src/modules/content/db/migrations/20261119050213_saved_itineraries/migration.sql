CREATE TABLE "content"."saved_itineraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"destination_name" varchar(120),
	"destination_place_id" varchar(100),
	"days_count" smallint NOT NULL,
	"items" jsonb NOT NULL,
	"source" varchar(10) NOT NULL,
	"source_post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_saved_itineraries_source" CHECK ("source" in ('reel', 'tripi', 'builder')),
	CONSTRAINT "ck_saved_itineraries_days" CHECK ("days_count" between 1 and 14)
);
--> statement-breakpoint
CREATE INDEX "idx_saved_itineraries_user_updated" ON "content"."saved_itineraries" ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_saved_itineraries_user_post" ON "content"."saved_itineraries" ("user_id","source_post_id") WHERE "source_post_id" is not null;