ALTER TABLE "signature_records" DROP CONSTRAINT "signature_records_payload_check";--> statement-breakpoint
ALTER TABLE "signature_records" ALTER COLUMN "payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signature_records" ADD COLUMN "seal_subject" text;--> statement-breakpoint
ALTER TABLE "signature_records" ADD COLUMN "seal_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signature_records" ADD COLUMN "seal_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "pdf_seal_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "date_mode" text DEFAULT 'declared' NOT NULL;--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_seal_metadata_check" CHECK (("signature_records"."seal_subject" IS NULL AND "signature_records"."seal_declared_at" IS NULL AND "signature_records"."seal_applied_at" IS NULL) OR ("signature_records"."seal_subject" IS NOT NULL AND "signature_records"."seal_declared_at" IS NOT NULL AND "signature_records"."seal_applied_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_payload_check" CHECK ("signature_records"."payload" IS NULL OR (jsonb_typeof("signature_records"."payload") = 'array' AND jsonb_array_length("signature_records"."payload") > 0));--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_date_mode_check" CHECK ("tenant_settings"."date_mode" IN ('declared', 'actual'));