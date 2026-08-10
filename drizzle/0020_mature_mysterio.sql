CREATE TABLE "pad_session_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"label" text NOT NULL,
	"last_polled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pad_session_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"request_id" uuid,
	"document" jsonb NOT NULL,
	"strokes" jsonb NOT NULL,
	"ink_color" text NOT NULL,
	"source_size" jsonb NOT NULL,
	"contributor_account_id" text NOT NULL,
	"contributor_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pad_sessions" ADD COLUMN "mode" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "pad_sessions" ADD COLUMN "current_document" jsonb;--> statement-breakpoint
ALTER TABLE "pad_session_participants" ADD CONSTRAINT "pad_session_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pad_session_participants" ADD CONSTRAINT "pad_session_participants_session_id_pad_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pad_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pad_session_participants" ADD CONSTRAINT "pad_session_participants_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pad_session_submissions" ADD CONSTRAINT "pad_session_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pad_session_submissions" ADD CONSTRAINT "pad_session_submissions_session_id_pad_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pad_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pad_session_submissions" ADD CONSTRAINT "pad_session_submissions_contributor_account_id_user_id_fk" FOREIGN KEY ("contributor_account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pad_session_participants_session_account_uidx" ON "pad_session_participants" USING btree ("session_id","account_id");--> statement-breakpoint
CREATE INDEX "pad_session_participants_tenant_session_idx" ON "pad_session_participants" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "pad_session_submissions_tenant_session_created_idx" ON "pad_session_submissions" USING btree ("tenant_id","session_id","created_at");--> statement-breakpoint
ALTER TABLE "pad_sessions" ADD CONSTRAINT "pad_sessions_mode_check" CHECK ("pad_sessions"."mode" IN ('private', 'shared'));