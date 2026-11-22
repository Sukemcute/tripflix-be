CREATE TABLE "content"."idempotency_keys" (
	"scope" text,
	"key" text,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_idempotency_keys" PRIMARY KEY("scope","key"),
	CONSTRAINT "ck_idempotency_keys_status" CHECK ("status" in ('processing', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "content"."moderation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"target_type" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sources" jsonb DEFAULT '[]' NOT NULL,
	"severity" integer DEFAULT 0 NOT NULL,
	"flags" jsonb DEFAULT '{}' NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"is_auto_hidden" boolean DEFAULT false NOT NULL,
	"resolution" varchar(20),
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."moderation_processed_events" (
	"consumer_group" varchar(50),
	"event_id" uuid,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_moderation_processed_events" PRIMARY KEY("consumer_group","event_id")
);
--> statement-breakpoint
CREATE TABLE "content"."reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"target_type" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason_code" varchar(50) NOT NULL,
	"reason_detail" text,
	"case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content"."comments" ADD COLUMN "status" varchar(20) DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."comments" ADD COLUMN "hidden_by_action_id" uuid;--> statement-breakpoint
ALTER TABLE "content"."comments" ADD COLUMN "cascade_root_comment_id" uuid;--> statement-breakpoint
ALTER TABLE "content"."moderation_actions" ADD COLUMN "target_type" varchar(20) DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."moderation_actions" ADD COLUMN "comment_id" uuid;--> statement-breakpoint
ALTER TABLE "content"."moderation_actions" ADD COLUMN "actor_type" varchar(20) DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."moderation_actions" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "content"."post_summaries" ADD COLUMN "source_comment_ids" jsonb;--> statement-breakpoint
ALTER TABLE "content"."moderation_actions" ALTER COLUMN "post_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_expires_at" ON "content"."idempotency_keys" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_moderation_cases_target_pending" ON "content"."moderation_cases" ("target_type","target_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_moderation_cases_queue" ON "content"."moderation_cases" ("status","severity" DESC NULLS LAST,"created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reports_target_reporter" ON "content"."reports" ("target_type","target_id","reporter_id");--> statement-breakpoint
CREATE INDEX "idx_reports_target_created" ON "content"."reports" ("target_type","target_id","created_at");--> statement-breakpoint
ALTER TABLE "content"."reports" ADD CONSTRAINT "reports_case_id_moderation_cases_id_fkey" FOREIGN KEY ("case_id") REFERENCES "content"."moderation_cases"("id");