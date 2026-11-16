ALTER TABLE "commerce"."flight_inventory" ADD COLUMN "changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."room_inventory" ADD COLUMN "changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."room_rates" ADD COLUMN "changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_flight_inventory_changed_at" ON "commerce"."flight_inventory" ("changed_at");--> statement-breakpoint
CREATE INDEX "ix_room_inventory_changed_at" ON "commerce"."room_inventory" ("changed_at");--> statement-breakpoint
CREATE INDEX "ix_room_rates_changed_at" ON "commerce"."room_rates" ("changed_at");--> statement-breakpoint
-- Trigger đặt changed_at bằng giờ thật lúc ghi (clock_timestamp, không phải giờ mở transaction) cho mọi đường ghi, kể cả SQL tay.
CREATE OR REPLACE FUNCTION "commerce"."set_changed_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.changed_at := clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tg_room_inventory_changed_at" BEFORE INSERT OR UPDATE ON "commerce"."room_inventory" FOR EACH ROW EXECUTE FUNCTION "commerce"."set_changed_at"();--> statement-breakpoint
CREATE TRIGGER "tg_room_rates_changed_at" BEFORE INSERT OR UPDATE ON "commerce"."room_rates" FOR EACH ROW EXECUTE FUNCTION "commerce"."set_changed_at"();--> statement-breakpoint
CREATE TRIGGER "tg_flight_inventory_changed_at" BEFORE INSERT OR UPDATE ON "commerce"."flight_inventory" FOR EACH ROW EXECUTE FUNCTION "commerce"."set_changed_at"();
--> statement-breakpoint
-- Cột mới chưa có thống kê: không ANALYZE thì câu nạp phần thay đổi bị chọn cách quét cả bảng (đo L1: 338 ms thay vì 0,05 ms).
ANALYZE "commerce"."room_inventory";--> statement-breakpoint
ANALYZE "commerce"."room_rates";--> statement-breakpoint
ANALYZE "commerce"."flight_inventory";
