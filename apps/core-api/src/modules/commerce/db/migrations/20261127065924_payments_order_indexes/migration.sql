CREATE INDEX "idx_payments_order_id" ON "commerce"."payments" ("order_id","status");--> statement-breakpoint
CREATE INDEX "idx_refunds_order_id" ON "commerce"."refunds" ("order_id");