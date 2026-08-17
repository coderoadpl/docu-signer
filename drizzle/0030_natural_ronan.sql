CREATE TABLE IF NOT EXISTS "hidden_filter_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_filter_values_kind_check" CHECK ("hidden_filter_values"."kind" IN ('person', 'tag')),
	CONSTRAINT "hidden_filter_values_value_length_check" CHECK (length("hidden_filter_values"."value") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "document_types" ADD COLUMN IF NOT EXISTS "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'hidden_filter_values_tenant_id_tenants_id_fk'
			AND conrelid = 'hidden_filter_values'::regclass
	) THEN
		ALTER TABLE "hidden_filter_values" ADD CONSTRAINT "hidden_filter_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hidden_filter_values_tenant_kind_value_uidx" ON "hidden_filter_values" USING btree ("tenant_id","kind","value");
