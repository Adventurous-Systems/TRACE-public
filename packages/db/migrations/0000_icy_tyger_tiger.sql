CREATE TABLE IF NOT EXISTS "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"price_pence" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"shipping_options" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"blockchain_tx_hash" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_passports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"gtin" text,
	"serial_number" text,
	"digital_link_uri" text,
	"qr_code_url" text,
	"product_name" text NOT NULL,
	"category_l1" text NOT NULL,
	"category_l2" text,
	"material_composition" jsonb DEFAULT '[]'::jsonb,
	"dimensions" jsonb,
	"technical_specs" jsonb DEFAULT '{}'::jsonb,
	"manufacturer_name" text,
	"country_of_origin" text,
	"production_date" date,
	"gwp_total" numeric,
	"embodied_carbon" numeric,
	"recycled_content" numeric,
	"epd_reference" text,
	"ce_marking" boolean DEFAULT false,
	"declaration_of_performance" text,
	"harmonised_standard" text,
	"previous_building_id" text,
	"deconstruction_date" date,
	"deconstruction_method" text,
	"reclaimed_by" text,
	"condition_grade" text,
	"condition_notes" text,
	"condition_photos" jsonb DEFAULT '[]'::jsonb,
	"original_age" integer,
	"remaining_life_estimate" integer,
	"carbon_savings_vs_new" numeric,
	"circularity_score" integer,
	"reuse_count" integer DEFAULT 0 NOT NULL,
	"reuse_suitability" jsonb DEFAULT '[]'::jsonb,
	"handling_requirements" text,
	"hazardous_substances" jsonb DEFAULT '[]'::jsonb,
	"custom_attributes" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"blockchain_tx_hash" text,
	"blockchain_passport_hash" text,
	"blockchain_anchored_at" timestamp with time zone,
	"registered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"slug" text NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb,
	"verified" boolean DEFAULT false NOT NULL,
	"blockchain_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "passport_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_data" jsonb NOT NULL,
	"actor_id" uuid,
	"blockchain_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quality_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid NOT NULL,
	"inspector_id" uuid NOT NULL,
	"structural_score" integer,
	"aesthetic_score" integer,
	"environmental_score" integer,
	"overall_grade" text,
	"report_notes" text,
	"photo_urls" jsonb DEFAULT '[]'::jsonb,
	"blockchain_tx_hash" text,
	"disputed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sensor_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid,
	"device_id" text NOT NULL,
	"sensor_type" text NOT NULL,
	"reading_value" jsonb NOT NULL,
	"blockchain_data_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"amount_pence" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dispute_deadline" timestamp with time zone,
	"blockchain_tx_hash" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"organisation_id" uuid,
	"blockchain_address" text,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_passport_id_material_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."material_passports"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_passports" ADD CONSTRAINT "material_passports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_passports" ADD CONSTRAINT "material_passports_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passport_events" ADD CONSTRAINT "passport_events_passport_id_material_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."material_passports"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passport_events" ADD CONSTRAINT "passport_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_passport_id_material_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."material_passports"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_passport_id_material_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."material_passports"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_status" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_org" ON "listings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_passport" ON "listings" USING btree ("passport_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_passports_org" ON "material_passports" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_passports_status" ON "material_passports" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_passports_category" ON "material_passports" USING btree ("category_l1","category_l2");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_passports_gtin" ON "material_passports" USING btree ("gtin");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_passports_search" ON "material_passports" USING gin (to_tsvector('english', "product_name" || ' ' || coalesce("category_l1", '') || ' ' || coalesce("category_l2", '') || ' ' || coalesce("condition_notes", '')));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_passport_events_passport" ON "passport_events" USING btree ("passport_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quality_reports_passport" ON "quality_reports" USING btree ("passport_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quality_reports_inspector" ON "quality_reports" USING btree ("inspector_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sensor_readings_passport" ON "sensor_readings" USING btree ("passport_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sensor_readings_device" ON "sensor_readings" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sensor_readings_created" ON "sensor_readings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_listing" ON "transactions" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_buyer" ON "transactions" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_status" ON "transactions" USING btree ("status");