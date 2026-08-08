CREATE TABLE "backfill_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cursor" text,
	"processed" integer DEFAULT 0 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backfill_checkpoints_name_unique" UNIQUE("name")
);
