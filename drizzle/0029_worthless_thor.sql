CREATE TABLE IF NOT EXISTS "document_metadata_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"proposed_changes" jsonb NOT NULL,
	"creator_account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_metadata_proposals_tenant_id_tenants_id_fk'
			AND conrelid = 'document_metadata_proposals'::regclass
	) THEN
		ALTER TABLE "document_metadata_proposals" ADD CONSTRAINT "document_metadata_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_metadata_proposals_creator_account_id_user_id_fk'
			AND conrelid = 'document_metadata_proposals'::regclass
	) THEN
		ALTER TABLE "document_metadata_proposals" ADD CONSTRAINT "document_metadata_proposals_creator_account_id_user_id_fk" FOREIGN KEY ("creator_account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_metadata_proposals_document_fk'
			AND conrelid = 'document_metadata_proposals'::regclass
	) THEN
		ALTER TABLE "document_metadata_proposals" ADD CONSTRAINT "document_metadata_proposals_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_metadata_proposals_changes_check'
			AND conrelid = 'document_metadata_proposals'::regclass
	) THEN
		ALTER TABLE "document_metadata_proposals" ADD CONSTRAINT "document_metadata_proposals_changes_check" CHECK (jsonb_typeof("document_metadata_proposals"."proposed_changes") = 'object' AND "document_metadata_proposals"."proposed_changes" <> '{}'::jsonb);
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_metadata_proposals_tenant_document_created_idx" ON "document_metadata_proposals" USING btree ("tenant_id","document_id","created_at","id");
