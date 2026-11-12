CREATE TABLE "discovery"."recommend_algos" (
	"name" text PRIMARY KEY,
	"post_builder" text NOT NULL,
	"user_builder" text NOT NULL,
	"ranker" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery"."recommend_interactions" (
	"actor_type" text,
	"actor_id" text,
	"kind" text,
	"target_type" text,
	"target_id" text,
	"ref_id" text,
	"value" double precision,
	"is_removed" boolean DEFAULT false NOT NULL,
	"detail" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_interactions_pkey" PRIMARY KEY("actor_type","actor_id","kind","ref_id")
);
--> statement-breakpoint
CREATE TABLE "discovery"."recommend_job_state" (
	"name" text PRIMARY KEY,
	"watermark" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "discovery"."recommend_post_scores" (
	"builder" text,
	"version" text,
	"post_id" uuid,
	"post_type" text NOT NULL,
	"score" double precision NOT NULL,
	"features" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_post_scores_pkey" PRIMARY KEY("builder","version","post_id")
);
--> statement-breakpoint
CREATE TABLE "discovery"."recommend_posts" (
	"post_id" uuid PRIMARY KEY,
	"author_id" uuid NOT NULL,
	"post_type" text NOT NULL,
	"tags" text[] NOT NULL,
	"place_id" text,
	"is_verified" boolean NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery"."recommend_user_features" (
	"builder" text,
	"version" text,
	"user_id" uuid,
	"features" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_user_features_pkey" PRIMARY KEY("builder","version","user_id")
);
--> statement-breakpoint
CREATE INDEX "idx_recommend_interactions_ingested_at" ON "discovery"."recommend_interactions" ("ingested_at");--> statement-breakpoint
CREATE INDEX "idx_recommend_interactions_kind_occurred_at" ON "discovery"."recommend_interactions" ("kind","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_recommend_post_scores_builder_version_post_type_score" ON "discovery"."recommend_post_scores" ("builder","version","post_type","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_recommend_posts_published_at" ON "discovery"."recommend_posts" ("published_at" DESC NULLS LAST);--> statement-breakpoint
-- Seed hai thuật toán bước 1 (đề xuất recommend-offline mục 5.3). Đổi thuật toán = UPDATE dòng này, không deploy.
INSERT INTO "discovery"."recommend_algos" ("name", "post_builder", "user_builder", "ranker") VALUES
	('for_you', 'hot@v0', 'tag_affinity@v0', 'tag_affinity_v0'),
	('trending', 'hot@v0', 'none@v0', 'popular_v0')
ON CONFLICT ("name") DO NOTHING;
