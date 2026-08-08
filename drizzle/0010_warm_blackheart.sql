ALTER TABLE "cards" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamptz;
