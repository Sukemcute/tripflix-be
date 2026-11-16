ALTER TABLE "content"."media_assets" ADD COLUMN "kind" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."media_assets" ADD COLUMN "width_px" integer;--> statement-breakpoint
ALTER TABLE "content"."media_assets" ADD COLUMN "height_px" integer;--> statement-breakpoint
ALTER TABLE "content"."media_assets" ALTER COLUMN "duration_sec" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."media_assets" ADD CONSTRAINT "ck_media_assets_kind" CHECK ("kind" in ('video', 'image'));--> statement-breakpoint
ALTER TABLE "content"."media_assets" ADD CONSTRAINT "ck_media_assets_dimensions" CHECK (("width_px" is null or "width_px" > 0) and ("height_px" is null or "height_px" > 0));--> statement-breakpoint
ALTER TABLE "content"."media_assets" DROP CONSTRAINT "ck_media_assets_mime_type", ADD CONSTRAINT "ck_media_assets_mime_type" CHECK (("kind" = 'video' and "mime_type" in ('video/mp4', 'video/quicktime')) or ("kind" = 'image' and "mime_type" in ('image/jpeg', 'image/png', 'image/webp')));--> statement-breakpoint
ALTER TABLE "content"."media_assets" DROP CONSTRAINT "ck_media_assets_duration_sec", ADD CONSTRAINT "ck_media_assets_duration_sec" CHECK (("kind" = 'video' and "duration_sec" is not null and "duration_sec" > 0) or ("kind" = 'image' and "duration_sec" is null));--> statement-breakpoint
ALTER TABLE "content"."media_assets" DROP CONSTRAINT "ck_media_assets_ready_has_playback", ADD CONSTRAINT "ck_media_assets_ready_has_playback" CHECK ("kind" = 'image' or "status" <> 'ready' or ("hls_prefix" is not null and "aspect" is not null));