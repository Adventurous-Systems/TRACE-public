CREATE TABLE IF NOT EXISTS "beta_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_role" text NOT NULL,
	"organisation_name" text,
	"target_organisation_id" uuid,
	"notes" text,
	"review_notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" DROP CONSTRAINT "listings_passport_id_material_passports_id_fk";
--> statement-breakpoint
ALTER TABLE "passport_events" DROP CONSTRAINT "passport_events_passport_id_material_passports_id_fk";
--> statement-breakpoint
ALTER TABLE "quality_reports" DROP CONSTRAINT "quality_reports_passport_id_material_passports_id_fk";
--> statement-breakpoint
ALTER TABLE "sensor_readings" DROP CONSTRAINT "sensor_readings_passport_id_material_passports_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_listing_id_listings_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "beta_access_requests" ADD CONSTRAINT "beta_access_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "beta_access_requests" ADD CONSTRAINT "beta_access_requests_target_organisation_id_organisations_id_fk" FOREIGN KEY ("target_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "beta_access_requests" ADD CONSTRAINT "beta_access_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_beta_access_requests_user" ON "beta_access_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_beta_access_requests_status" ON "beta_access_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_beta_access_requests_target_org" ON "beta_access_requests" USING btree ("target_organisation_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_passport_id_material_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."material_passports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passport_events" ADD CONSTRAINT "passport_events_passport_id_material_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."material_passports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_passport_id_material_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."material_passports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_passport_id_material_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."material_passports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
