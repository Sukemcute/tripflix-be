CREATE TABLE "discovery"."recommend_text_vectors" (
	"model" text,
	"text_hash" text,
	"vector" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_text_vectors_pkey" PRIMARY KEY("model","text_hash")
);
