ALTER TABLE "commerce"."payments" ADD COLUMN "gateway_bank_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "gateway_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD COLUMN "gateway_bank_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD COLUMN "gateway_refunded_at" timestamp with time zone;