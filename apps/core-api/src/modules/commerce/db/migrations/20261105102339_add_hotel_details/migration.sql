ALTER TABLE "commerce"."properties" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD COLUMN "rating_avg" double precision;--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD COLUMN "rating_source" text;--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD COLUMN "check_in_time" text;--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD COLUMN "check_out_time" text;--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD COLUMN "details" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."room_types" ADD COLUMN "details" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD CONSTRAINT "ck_properties_rating_avg" CHECK ("rating_avg" is null or "rating_avg" between 0 and 5);--> statement-breakpoint
ALTER TABLE "commerce"."properties" ADD CONSTRAINT "ck_properties_review_count" CHECK ("review_count" >= 0);