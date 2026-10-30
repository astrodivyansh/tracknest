CREATE TABLE "maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'scheduled' NOT NULL,
	"due_date" date,
	"repeat_months" integer,
	"vendor" text,
	"notes" text,
	"cost" numeric(12, 2),
	"completion_notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" text
);
--> statement-breakpoint
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_org_state_idx" ON "maintenance" USING btree ("org_id","state","due_date");--> statement-breakpoint
CREATE INDEX "maintenance_asset_idx" ON "maintenance" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_one_active_uq" ON "maintenance" USING btree ("asset_id") WHERE state = 'in_progress';--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON maintenance TO tracknest_app;
--> statement-breakpoint
ALTER TABLE maintenance ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON maintenance TO tracknest_app
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
