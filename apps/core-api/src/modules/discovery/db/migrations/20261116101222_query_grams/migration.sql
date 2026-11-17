CREATE TABLE "discovery"."search_query_grams" (
	"day" date,
	"gram" text,
	"hits" integer NOT NULL,
	"samples" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "search_query_grams_pkey" PRIMARY KEY("day","gram")
);
