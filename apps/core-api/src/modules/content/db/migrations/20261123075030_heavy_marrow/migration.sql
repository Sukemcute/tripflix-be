CREATE INDEX "idx_posts_hashtags" ON "content"."posts" USING gin ("hashtags");--> statement-breakpoint
CREATE INDEX "idx_posts_updated_id" ON "content"."posts" ("updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_post_counter_deltas_post_id" ON "content"."post_counter_deltas" ("post_id");