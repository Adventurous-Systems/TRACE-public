CREATE TABLE IF NOT EXISTS "governance_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"organisation_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"voting_ends_at" timestamp with time zone NOT NULL,
	"for_votes" numeric DEFAULT '0' NOT NULL,
	"against_votes" numeric DEFAULT '0' NOT NULL,
	"quorum_snapshot" numeric DEFAULT '0' NOT NULL,
	"quorum_reached" boolean DEFAULT false NOT NULL,
	"blockchain_tx_hash" text,
	"blockchain_proposal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "governance_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"support" boolean NOT NULL,
	"weight" numeric DEFAULT '1' NOT NULL,
	"blockchain_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gov_votes_unique" UNIQUE("proposal_id","voter_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_proposals" ADD CONSTRAINT "governance_proposals_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_proposals" ADD CONSTRAINT "governance_proposals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_votes" ADD CONSTRAINT "governance_votes_proposal_id_governance_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."governance_proposals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_votes" ADD CONSTRAINT "governance_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gov_proposals_status" ON "governance_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gov_proposals_creator" ON "governance_proposals" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gov_votes_proposal" ON "governance_votes" USING btree ("proposal_id");
