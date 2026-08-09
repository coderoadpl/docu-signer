ALTER TABLE "documents" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_name_length_check" CHECK (length("api_tokens"."name") BETWEEN 1 AND 120),
	CONSTRAINT "api_tokens_scopes_check" CHECK ("api_tokens"."scopes" <@ '["read", "write", "write:draft"]'::jsonb AND jsonb_array_length("api_tokens"."scopes") BETWEEN 1 AND 3)
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_user_created_idx" ON "api_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_uidx" ON "api_tokens" USING btree ("token_hash");
