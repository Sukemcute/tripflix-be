CREATE SCHEMA IF NOT EXISTS "content";
--> statement-breakpoint
CREATE TABLE "content"."media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_id" uuid NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"source_key" text NOT NULL,
	"s3_upload_id" text,
	"hls_prefix" text,
	"duration_sec" integer NOT NULL,
	"aspect" text,
	"transcode_attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_media_assets_status" CHECK ("status" in ('uploading', 'processing', 'ready', 'failed')),
	CONSTRAINT "ck_media_assets_mime_type" CHECK ("mime_type" in ('video/mp4', 'video/quicktime')),
	CONSTRAINT "ck_media_assets_aspect" CHECK ("aspect" in ('9:16', '16:9', '1:1')),
	CONSTRAINT "ck_media_assets_file_size_bytes" CHECK ("file_size_bytes" > 0),
	CONSTRAINT "ck_media_assets_duration_sec" CHECK ("duration_sec" > 0),
	CONSTRAINT "ck_media_assets_transcode_attempts" CHECK ("transcode_attempts" >= 0),
	CONSTRAINT "ck_media_assets_ready_has_playback" CHECK ("status" <> 'ready' or ("hls_prefix" is not null and "aspect" is not null))
);
--> statement-breakpoint
CREATE TABLE "content"."renditions" (
	"asset_id" uuid,
	"level" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_renditions" PRIMARY KEY("asset_id","level"),
	CONSTRAINT "ck_renditions_level" CHECK ("level" in (360, 540, 720))
);
--> statement-breakpoint
ALTER TABLE "content"."renditions" ADD CONSTRAINT "fk_renditions_asset_id" FOREIGN KEY ("asset_id") REFERENCES "content"."media_assets"("id") ON DELETE CASCADE;