ALTER TABLE "commerce"."orders" ADD COLUMN "children" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "infants" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "ck_orders_children" CHECK ("children" >= 0 and "adults" + "children" <= 9);--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "ck_orders_infants" CHECK ("infants" between 0 and "adults");