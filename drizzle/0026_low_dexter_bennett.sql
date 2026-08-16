CREATE TABLE IF NOT EXISTS "document_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"author_account_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_comments_tenant_id_tenants_id_fk'
			AND conrelid = 'document_comments'::regclass
	) THEN
		ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_comments_author_account_id_user_id_fk'
			AND conrelid = 'document_comments'::regclass
	) THEN
		ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_author_account_id_user_id_fk" FOREIGN KEY ("author_account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_comments_document_fk'
			AND conrelid = 'document_comments'::regclass
	) THEN
		ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'document_comments_body_check'
			AND conrelid = 'document_comments'::regclass
	) THEN
		ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_body_check" CHECK ("document_comments"."body" = btrim("document_comments"."body") AND length("document_comments"."body") BETWEEN 1 AND 2000);
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comments_tenant_document_created_idx" ON "document_comments" USING btree ("tenant_id","document_id","created_at","id");
