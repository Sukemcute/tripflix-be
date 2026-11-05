CREATE TABLE "access"."service_clients" (
	"client_id" text PRIMARY KEY,
	"secret_hash" text NOT NULL,
	"allowed_audiences" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "ck_service_clients_client_id_format" CHECK ("client_id" ~ '^[a-z][a-z0-9-]{1,49}$'),
	CONSTRAINT "ck_service_clients_allowed_audiences_not_empty" CHECK (cardinality("allowed_audiences") > 0)
);
