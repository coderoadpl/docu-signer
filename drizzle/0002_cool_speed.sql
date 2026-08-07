CREATE TABLE "document_files" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"role" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"doc_type" text NOT NULL,
	"document_date" text NOT NULL,
	"person" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_files_documentId_idx" ON "document_files" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_tenantId_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_documentDate_idx" ON "documents" USING btree ("tenant_id","document_date");
--> statement-breakpoint
INSERT INTO "tenants" ("id", "slug", "name", "created_at")
VALUES ('tenant-default', 'default', 'Default', '2026-07-18T00:00:00.000Z')
ON CONFLICT DO NOTHING;
