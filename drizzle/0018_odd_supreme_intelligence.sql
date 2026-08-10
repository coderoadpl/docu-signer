CREATE TABLE "signature_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"signed_by" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_records_payload_check" CHECK (jsonb_typeof("signature_records"."payload") = 'array' AND jsonb_array_length("signature_records"."payload") > 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"store_signature_records" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_file_id_document_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."document_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signature_records_tenant_document_created_idx" ON "signature_records" USING btree ("tenant_id","document_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_records_file_uidx" ON "signature_records" USING btree ("file_id");