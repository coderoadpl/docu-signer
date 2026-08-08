DROP INDEX "cards_tenant_column_idx";--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "board" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "visited" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "cards_tenant_board_column_idx" ON "cards" USING btree ("tenant_id","board","column","position");