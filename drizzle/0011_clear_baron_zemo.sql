ALTER TABLE "documents" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_period_order_check" CHECK ("documents"."period_start" IS NULL OR "documents"."period_end" IS NULL OR "documents"."period_start" <= "documents"."period_end");