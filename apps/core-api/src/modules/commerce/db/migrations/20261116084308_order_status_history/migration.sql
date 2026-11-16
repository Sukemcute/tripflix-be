CREATE TABLE "commerce"."order_status_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."order_status_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"source" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "status_source" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "status_request_id" text;--> statement-breakpoint
CREATE INDEX "idx_order_status_history_order_id" ON "commerce"."order_status_history" ("order_id","created_at");--> statement-breakpoint
ALTER TABLE "commerce"."order_status_history" ADD CONSTRAINT "fk_order_status_history_order_id" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id");--> statement-breakpoint
-- D1: mỗi lần tạo đơn hoặc đổi trạng thái, chép một dòng sang lịch sử. Nguồn và mã request do code ghi vào chính dòng đơn
-- (status_source, status_request_id) trong cùng câu UPDATE, nên không tốn thêm lượt gọi database.
CREATE OR REPLACE FUNCTION "commerce"."log_order_status"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO "commerce"."order_status_history" (order_id, from_status, to_status, source, request_id)
    VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status, NEW.status_source, NEW.status_request_id);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tg_orders_status_history" AFTER INSERT OR UPDATE OF status ON "commerce"."orders" FOR EACH ROW EXECUTE FUNCTION "commerce"."log_order_status"();--> statement-breakpoint
-- Đơn có sẵn: một dòng khởi đầu với trạng thái hiện tại, để mọi đơn đều có lịch sử.
INSERT INTO "commerce"."order_status_history" (order_id, from_status, to_status, source, created_at)
SELECT id, NULL, status, 'backfill', updated_at FROM "commerce"."orders";
