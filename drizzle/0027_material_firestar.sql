CREATE TABLE IF NOT EXISTS "document_types" (
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_types_tenant_id_slug_pk" PRIMARY KEY("tenant_id","slug"),
	CONSTRAINT "document_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_doc_type_check";
--> statement-breakpoint
INSERT INTO "document_types" ("tenant_id", "slug", "label", "position")
SELECT "tenants"."id", "defaults"."slug", "defaults"."label", "defaults"."position"
FROM "tenants"
CROSS JOIN (
	VALUES
		('umowa-uod', 'Umowa UoD', 10),
		('uchwala', 'Uchwała', 20),
		('protokol', 'Protokół', 30),
		('rachunek', 'Rachunek', 40),
		('inny', 'Inny', 50)
) AS "defaults"("slug", "label", "position")
ON CONFLICT DO NOTHING;
