ALTER TABLE "document_comments" ADD COLUMN IF NOT EXISTS "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document_links" ADD COLUMN IF NOT EXISTS "draft" boolean DEFAULT false NOT NULL;
