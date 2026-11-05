CREATE TABLE "commerce"."order_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"birthdate" date
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" uuid NOT NULL,
	"product_type" text NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"date" date NOT NULL,
	"nights" smallint NOT NULL,
	"qty" smallint NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"rate_plan_code" text NOT NULL,
	"rate_plan_name" text NOT NULL,
	"is_refundable" boolean NOT NULL,
	"free_cancel_until" date,
	"confirmation_code" text,
	CONSTRAINT "ck_order_items_product_type" CHECK ("product_type" in ('room', 'flight')),
	CONSTRAINT "ck_order_items_qty" CHECK ("qty" between 1 and 9),
	CONSTRAINT "ck_order_items_nights" CHECK ("nights" between 1 and 14)
);
--> statement-breakpoint
CREATE TABLE "commerce"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total" bigint NOT NULL,
	"adults" smallint NOT NULL,
	"source_post_id" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"policy_version" text,
	"policy_accepted_at" timestamp with time zone,
	"hold_expires_at" timestamp with time zone NOT NULL,
	"confirmation_code" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "ck_orders_status" CHECK ("status" in ('pending', 'paying', 'paid', 'cancelled', 'expired')),
	CONSTRAINT "ck_orders_total" CHECK ("total" > 0),
	CONSTRAINT "ck_orders_adults" CHECK ("adults" between 1 and 9)
);
--> statement-breakpoint
CREATE TABLE "commerce"."idempotency_keys" (
	"scope" text,
	"key" text,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_idempotency_keys" PRIMARY KEY("scope","key"),
	CONSTRAINT "ck_idempotency_keys_status" CHECK ("status" in ('processing', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."outbox_events" (
	"id" uuid PRIMARY KEY,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"producer" text NOT NULL,
	"payload" jsonb NOT NULL,
	"user_id" uuid,
	"trace_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "commerce"."mock_gateway_ops" (
	"gateway_key" text PRIMARY KEY,
	"op" text NOT NULL,
	"ref" text NOT NULL,
	"amount" bigint,
	"status" text NOT NULL,
	"code" text,
	"last4" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"gateway_key" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"gateway" text NOT NULL,
	"gateway_ref" text,
	"failure_code" text,
	"card_last4" text,
	"challenge_id" text,
	"check_attempts" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_payments_status" CHECK ("status" in ('initiated', 'requires_action', 'succeeded', 'failed')),
	CONSTRAINT "ck_payments_amount" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"gateway_key" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"gateway_ref" text,
	"check_attempts" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_refunds_status" CHECK ("status" in ('initiated', 'succeeded')),
	CONSTRAINT "ck_refunds_amount" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE INDEX "idx_order_guests_order_id" ON "commerce"."order_guests" ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_items_order_id" ON "commerce"."order_items" ("order_id");--> statement-breakpoint
CREATE INDEX "idx_orders_user_id" ON "commerce"."orders" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_hold" ON "commerce"."orders" ("status","hold_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_one_pending_per_user" ON "commerce"."orders" ("user_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_expires_at" ON "commerce"."idempotency_keys" ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_events_unpublished" ON "commerce"."outbox_events" ("occurred_at") WHERE "published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_gateway_key" ON "commerce"."payments" ("gateway_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_one_live_per_order" ON "commerce"."payments" ("order_id") WHERE "status" in ('initiated', 'requires_action', 'succeeded');--> statement-breakpoint
CREATE INDEX "idx_payments_due" ON "commerce"."payments" ("next_check_at") WHERE "status" = 'initiated' and not "needs_review";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_refunds_gateway_key" ON "commerce"."refunds" ("gateway_key");--> statement-breakpoint
ALTER TABLE "commerce"."order_guests" ADD CONSTRAINT "fk_order_guests_order_id" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id");--> statement-breakpoint
ALTER TABLE "commerce"."order_items" ADD CONSTRAINT "fk_order_items_order_id" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id");--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "fk_payments_order_id" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id");--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "fk_refunds_order_id" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id");--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "fk_refunds_payment_id" FOREIGN KEY ("payment_id") REFERENCES "commerce"."payments"("id");