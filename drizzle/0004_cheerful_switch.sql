-- Members aggregate build-out. `members` is on the §Data-conventions GRANDFATHER
-- list (text id + text ISO created_at), so it is NOT migrated to uuid/timestamptz:
-- the new columns join that same text convention on purpose (a single table must
-- not mix a text created_at with a timestamptz last_seen_at). New SIBLING
-- aggregates keyed by member_id adopt uuid/timestamptz. user_id becomes nullable
-- because ensureMember provisions a member row before any auth account exists.
ALTER TABLE "members" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "marketing_consents" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "external_customer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "last_seen_at" text;--> statement-breakpoint
CREATE UNIQUE INDEX "members_tenant_email_uidx" ON "members" USING btree ("tenant_id","email");