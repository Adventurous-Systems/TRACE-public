ALTER TABLE "material_passports" ADD COLUMN IF NOT EXISTS "blockchain_chain_id" text;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD COLUMN IF NOT EXISTS "chain_id" text;
