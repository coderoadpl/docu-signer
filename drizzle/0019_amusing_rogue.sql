CREATE TABLE "source_update_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"approver_id" text NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "source_update_approvals_decision_check" CHECK ("source_update_approvals"."decision" IN ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "source_update_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"new_source_file_id" uuid NOT NULL,
	"new_signed_file_id" uuid,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"prior_source_file_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"prior_signed_file_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	CONSTRAINT "source_update_requests_mode_check" CHECK ("source_update_requests"."mode" IN ('delete-signed', 'transfer')),
	CONSTRAINT "source_update_requests_status_check" CHECK ("source_update_requests"."status" IN ('pending', 'completed', 'rejected', 'cancelled'))
);
--> statement-breakpoint
DROP INDEX "signature_records_file_uidx";--> statement-breakpoint
ALTER TABLE "signature_records" ADD COLUMN "replayed_from_id" uuid;--> statement-breakpoint
ALTER TABLE "source_update_approvals" ADD CONSTRAINT "source_update_approvals_request_id_source_update_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."source_update_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_update_approvals" ADD CONSTRAINT "source_update_approvals_approver_id_user_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_update_requests" ADD CONSTRAINT "source_update_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_update_requests" ADD CONSTRAINT "source_update_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_update_requests" ADD CONSTRAINT "source_update_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_update_requests" ADD CONSTRAINT "source_update_requests_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_update_approvals_approver_decision_idx" ON "source_update_approvals" USING btree ("approver_id","decision");--> statement-breakpoint
CREATE UNIQUE INDEX "source_update_approvals_request_approver_uidx" ON "source_update_approvals" USING btree ("request_id","approver_id");--> statement-breakpoint
CREATE INDEX "source_update_requests_tenant_status_idx" ON "source_update_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "source_update_requests_document_pending_uidx" ON "source_update_requests" USING btree ("document_id") WHERE "source_update_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "signature_records_file_uidx" ON "signature_records" USING btree ("file_id") WHERE "signature_records"."replayed_from_id" IS NULL;