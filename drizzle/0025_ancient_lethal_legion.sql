CREATE TABLE IF NOT EXISTS "document_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"from_document_id" uuid NOT NULL,
	"to_document_id" uuid NOT NULL,
	"label" text,
	CONSTRAINT "document_links_distinct_documents_check" CHECK ("document_links"."from_document_id" <> "document_links"."to_document_id"),
	CONSTRAINT "document_links_label_check" CHECK ("document_links"."label" IS NULL OR ("document_links"."label" = btrim("document_links"."label") AND length("document_links"."label") BETWEEN 1 AND 60))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_tenant_id_uidx" ON "documents" USING btree ("tenant_id","id");--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_links_tenant_id_tenants_id_fk'
			AND conrelid = 'document_links'::regclass
	) THEN
		ALTER TABLE "document_links" ADD CONSTRAINT "document_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_links_from_document_fk'
			AND conrelid = 'document_links'::regclass
	) THEN
		ALTER TABLE "document_links" ADD CONSTRAINT "document_links_from_document_fk" FOREIGN KEY ("tenant_id","from_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_links_to_document_fk'
			AND conrelid = 'document_links'::regclass
	) THEN
		ALTER TABLE "document_links" ADD CONSTRAINT "document_links_to_document_fk" FOREIGN KEY ("tenant_id","to_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_links_tenant_pair_uidx" ON "document_links" USING btree ("tenant_id","from_document_id","to_document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_links_tenant_from_idx" ON "document_links" USING btree ("tenant_id","from_document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_links_tenant_to_idx" ON "document_links" USING btree ("tenant_id","to_document_id");
