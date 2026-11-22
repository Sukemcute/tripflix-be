-- K3: trước khi thêm ràng buộc duy nhất, đổi mã của các đơn trùng (giữ mã cho đơn tạo sớm nhất).
-- Mã mới = mã cũ + 2 ký tự lấy từ id đơn; mục đầu của đơn mang cùng mã nên đổi theo.
WITH dup AS (
  SELECT id, confirmation_code AS old_code,
         confirmation_code || upper(substr(md5(id::text), 1, 2)) AS new_code
  FROM (
    SELECT id, confirmation_code, row_number() OVER (PARTITION BY confirmation_code ORDER BY created_at, id) AS rn
    FROM "commerce"."orders" WHERE confirmation_code IS NOT NULL
  ) ranked
  WHERE rn > 1
), fixed_items AS (
  UPDATE "commerce"."order_items" i SET confirmation_code = dup.new_code
  FROM dup WHERE i.order_id = dup.id AND i.confirmation_code = dup.old_code
)
UPDATE "commerce"."orders" o SET confirmation_code = dup.new_code FROM dup WHERE o.id = dup.id;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_confirmation_code" ON "commerce"."orders" ("confirmation_code");
