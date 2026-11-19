CREATE TABLE "content"."media_frame_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"asset_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"source_key" text NOT NULL,
	"policy" text NOT NULL,
	"request_id" uuid NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"manifest" jsonb,
	"error_code" text,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"retried_by" uuid,
	"retried_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_media_frame_scans_status" CHECK ("status" IN ('requested','ready','failed')),
	CONSTRAINT "ck_media_frame_scans_attempts" CHECK ("attempts" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_frame_scans_revision" ON "content"."media_frame_scans" ("asset_id","revision","policy");--> statement-breakpoint
CREATE INDEX "idx_media_frame_scans_asset" ON "content"."media_frame_scans" ("asset_id");--> statement-breakpoint
ALTER TABLE "content"."media_frame_scans" ADD CONSTRAINT "media_frame_scans_asset_id_media_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "content"."media_assets"("id") ON DELETE CASCADE;