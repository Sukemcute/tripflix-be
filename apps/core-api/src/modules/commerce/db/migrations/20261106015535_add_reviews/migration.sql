CREATE TABLE "commerce"."reviews" (
	"id" text PRIMARY KEY,
	"property_id" text NOT NULL,
	"room_type_id" text,
	"booking_id" text,
	"user_id" uuid,
	"author_name" text NOT NULL,
	"rating" smallint NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"images" jsonb DEFAULT '[]' NOT NULL,
	"traveler_type" text,
	"stay_month" date,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reviews_rating" CHECK ("rating" between 1 and 5),
	CONSTRAINT "ck_reviews_status" CHECK ("status" in ('published', 'hidden')),
	CONSTRAINT "ck_reviews_helpful_count" CHECK ("helpful_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_reviews_property_id_created_at" ON "commerce"."reviews" ("property_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reviews_booking_id" ON "commerce"."reviews" ("booking_id");--> statement-breakpoint
ALTER TABLE "commerce"."reviews" ADD CONSTRAINT "fk_reviews_property_id" FOREIGN KEY ("property_id") REFERENCES "commerce"."properties"("id");--> statement-breakpoint
ALTER TABLE "commerce"."reviews" ADD CONSTRAINT "fk_reviews_room_type_id" FOREIGN KEY ("room_type_id") REFERENCES "commerce"."room_types"("id");