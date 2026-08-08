CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"role" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "document_files_role_check" CHECK ("document_files"."role" IN ('source', 'signed-scan', 'signed-digital', 'other')),
	CONSTRAINT "document_files_size_check" CHECK ("document_files"."size_bytes" >= 0 AND "document_files"."size_bytes" <= 26214400)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"doc_type" text NOT NULL,
	"document_date" date NOT NULL,
	"person" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_doc_type_check" CHECK ("documents"."doc_type" IN ('umowa-uod', 'uchwala', 'protokol', 'rachunek', 'inny'))
);
--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_files_document_idx" ON "document_files" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_tenant_date_idx" ON "documents" USING btree ("tenant_id","document_date");