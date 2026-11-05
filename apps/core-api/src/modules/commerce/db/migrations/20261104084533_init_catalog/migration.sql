CREATE SCHEMA IF NOT EXISTS "commerce";
--> statement-breakpoint
CREATE TABLE "commerce"."flight_inventory" (
	"flight_id" text,
	"date" date,
	"total" integer NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	"price" bigint NOT NULL,
	"stop_sell" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pk_flight_inventory" PRIMARY KEY("flight_id","date"),
	CONSTRAINT "ck_flight_inventory_not_oversold" CHECK ("held" >= 0 and "sold" >= 0 and "held" + "sold" <= "total"),
	CONSTRAINT "ck_flight_inventory_price" CHECK ("price" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."flights" (
	"id" text PRIMARY KEY,
	"flight_key" text NOT NULL,
	"name" text NOT NULL,
	"airline" text,
	"from_airport" text NOT NULL,
	"to_airport" text NOT NULL,
	"depart_time" text,
	"arrive_time" text,
	"destination_slug" text NOT NULL,
	"destination_name" text NOT NULL,
	"cabin_code" text NOT NULL,
	"cabin_name" text NOT NULL,
	"default_seats" integer NOT NULL,
	"default_price" bigint NOT NULL,
	"fare_plans" jsonb NOT NULL,
	CONSTRAINT "ck_flights_default_seats" CHECK ("default_seats" >= 0),
	CONSTRAINT "ck_flights_default_price" CHECK ("default_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."properties" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"province_slug" text NOT NULL,
	"province_name" text NOT NULL,
	"city" text,
	"stars" smallint,
	"brand" text,
	"style" text,
	"thumbnail" text,
	"images" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_properties_stars" CHECK ("stars" is null or "stars" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "commerce"."room_inventory" (
	"room_type_id" text,
	"date" date,
	"total" integer NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	"stop_sell" boolean DEFAULT false NOT NULL,
	"cta" boolean DEFAULT false NOT NULL,
	"ctd" boolean DEFAULT false NOT NULL,
	"min_los" smallint DEFAULT 1 NOT NULL,
	"max_los" smallint DEFAULT 14 NOT NULL,
	CONSTRAINT "pk_room_inventory" PRIMARY KEY("room_type_id","date"),
	CONSTRAINT "ck_room_inventory_not_oversold" CHECK ("held" >= 0 and "sold" >= 0 and "held" + "sold" <= "total"),
	CONSTRAINT "ck_room_inventory_los" CHECK ("min_los" >= 1 and "max_los" >= "min_los")
);
--> statement-breakpoint
CREATE TABLE "commerce"."room_rates" (
	"room_type_id" text,
	"date" date,
	"price" bigint NOT NULL,
	CONSTRAINT "pk_room_rates" PRIMARY KEY("room_type_id","date"),
	CONSTRAINT "ck_room_rates_price" CHECK ("price" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."room_types" (
	"id" text PRIMARY KEY,
	"property_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"max_guests" smallint NOT NULL,
	"default_total" integer NOT NULL,
	"default_price" bigint NOT NULL,
	"rate_plans" jsonb NOT NULL,
	CONSTRAINT "ck_room_types_max_guests" CHECK ("max_guests" > 0),
	CONSTRAINT "ck_room_types_default_total" CHECK ("default_total" >= 0),
	CONSTRAINT "ck_room_types_default_price" CHECK ("default_price" > 0)
);
--> statement-breakpoint
CREATE INDEX "idx_flights_route" ON "commerce"."flights" ("from_airport","to_airport");--> statement-breakpoint
CREATE INDEX "idx_flights_flight_key" ON "commerce"."flights" ("flight_key");--> statement-breakpoint
CREATE INDEX "idx_properties_province_slug" ON "commerce"."properties" ("province_slug");--> statement-breakpoint
CREATE INDEX "idx_room_types_property_id" ON "commerce"."room_types" ("property_id");--> statement-breakpoint
ALTER TABLE "commerce"."flight_inventory" ADD CONSTRAINT "fk_flight_inventory_flight_id" FOREIGN KEY ("flight_id") REFERENCES "commerce"."flights"("id");--> statement-breakpoint
ALTER TABLE "commerce"."room_inventory" ADD CONSTRAINT "fk_room_inventory_room_type_id" FOREIGN KEY ("room_type_id") REFERENCES "commerce"."room_types"("id");--> statement-breakpoint
ALTER TABLE "commerce"."room_rates" ADD CONSTRAINT "fk_room_rates_room_type_id" FOREIGN KEY ("room_type_id") REFERENCES "commerce"."room_types"("id");--> statement-breakpoint
ALTER TABLE "commerce"."room_types" ADD CONSTRAINT "fk_room_types_property_id" FOREIGN KEY ("property_id") REFERENCES "commerce"."properties"("id");