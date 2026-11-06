ALTER TABLE "commerce"."flights" ADD COLUMN "airline_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."flights" ADD COLUMN "flight_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."flights" ADD COLUMN "stops" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."flights" ADD CONSTRAINT "ck_flights_stops" CHECK ("stops" >= 0);