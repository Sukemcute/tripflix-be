ALTER TABLE "commerce"."properties" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "commerce"."properties" SET "slug" = lower("id");--> statement-breakpoint
ALTER TABLE "commerce"."properties" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_properties_slug" ON "commerce"."properties" USING btree ("slug");
