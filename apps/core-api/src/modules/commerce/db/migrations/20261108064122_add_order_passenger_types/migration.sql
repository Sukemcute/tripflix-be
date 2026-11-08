ALTER TABLE "commerce"."order_guests" ADD COLUMN "passenger_type" text;--> statement-breakpoint
ALTER TABLE "commerce"."order_items" ADD COLUMN "child_unit_price" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."order_items" ADD COLUMN "infant_unit_price" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "children" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "infants" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."order_guests" ADD CONSTRAINT "ck_order_guests_passenger_type" CHECK ("passenger_type" in ('adult', 'child', 'infant'));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "ck_orders_children" CHECK ("children" >= 0 and "adults" + "children" <= 9);--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "ck_orders_infants" CHECK ("infants" between 0 and "adults");