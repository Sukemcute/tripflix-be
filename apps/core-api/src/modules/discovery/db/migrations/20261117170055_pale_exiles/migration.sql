CREATE TABLE "discovery"."recommend_product_features" (
	"builder" text,
	"version" text,
	"product_type" text NOT NULL,
	"product_id" text,
	"group_key" text NOT NULL,
	"score" double precision NOT NULL,
	"features" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_product_features_pkey" PRIMARY KEY("builder","version","product_id"),
	CONSTRAINT "ck_recommend_product_features_product_type" CHECK ("product_type" in ('hotel', 'flight'))
);
