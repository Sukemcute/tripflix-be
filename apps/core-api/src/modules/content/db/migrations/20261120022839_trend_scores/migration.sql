CREATE TABLE "content"."trend_scores" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content"."trend_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"post_id" uuid NOT NULL,
	"score" double precision NOT NULL,
	"raw" double precision NOT NULL,
	"decayed_signal" double precision NOT NULL,
	"completeness" double precision NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_trend_scores_post_id" ON "content"."trend_scores" ("post_id");--> statement-breakpoint
CREATE INDEX "idx_trend_scores_score" ON "content"."trend_scores" ("score" DESC NULLS LAST,"post_id");--> statement-breakpoint
ALTER TABLE "content"."trend_scores" ADD CONSTRAINT "trend_scores_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE CASCADE;