CREATE TABLE "discovery"."search_counts" (
	"ns" text,
	"key" text,
	"n" double precision NOT NULL,
	CONSTRAINT "search_counts_pkey" PRIMARY KEY("ns","key")
);
--> statement-breakpoint
CREATE TABLE "discovery"."search_documents" (
	"id" text PRIMARY KEY,
	"vertical" text NOT NULL,
	"ord" integer NOT NULL,
	"place" text,
	"lat" double precision,
	"lon" double precision,
	"days" integer,
	"tier" text,
	"terms" text[] NOT NULL,
	"streets" text[] NOT NULL,
	"doc" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_search_documents_vertical_ord" ON "discovery"."search_documents" ("vertical","ord");--> statement-breakpoint
CREATE INDEX "idx_search_documents_terms" ON "discovery"."search_documents" USING gin ("terms");--> statement-breakpoint
CREATE INDEX "idx_search_documents_streets" ON "discovery"."search_documents" USING gin ("streets");--> statement-breakpoint
CREATE INDEX "idx_search_documents_place" ON "discovery"."search_documents" ("place");--> statement-breakpoint
CREATE INDEX "idx_search_documents_lat" ON "discovery"."search_documents" ("lat") WHERE "lat" is not null;