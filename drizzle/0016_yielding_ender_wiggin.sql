CREATE TABLE "pad_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_by" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"current_request" jsonb,
	"submitted_strokes" jsonb,
	CONSTRAINT "pad_sessions_status_check" CHECK ("pad_sessions"."status" IN ('active', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "pad_sessions" ADD CONSTRAINT "pad_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pad_sessions" ADD CONSTRAINT "pad_sessions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pad_sessions_tenant_created_idx" ON "pad_sessions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "pad_sessions_tenant_expires_idx" ON "pad_sessions" USING btree ("tenant_id","expires_at");