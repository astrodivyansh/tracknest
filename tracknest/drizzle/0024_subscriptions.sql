CREATE TABLE "subscription_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"asset_id" uuid,
	"person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"reference" text,
	"notes" text,
	"invoice_key" text,
	"invoice_name" text,
	"invoice_type" text,
	"invoice_size" integer,
	"actor_name" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"name" text NOT NULL,
	"vendor" text,
	"plan" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"period_months" integer NOT NULL,
	"next_due_on" date NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"seats" integer,
	"owner_id" uuid,
	"remind_days" integer DEFAULT 7 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_id_persons_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_links_asset_uq" ON "subscription_links" USING btree ("subscription_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_links_person_uq" ON "subscription_links" USING btree ("subscription_id","person_id");--> statement-breakpoint
CREATE INDEX "subscription_payments_sub_idx" ON "subscription_payments" USING btree ("subscription_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_tag_uq" ON "subscriptions" USING btree ("org_id","tag");--> statement-breakpoint
CREATE INDEX "subscriptions_due_idx" ON "subscriptions" USING btree ("org_id","state","next_due_on");--> statement-breakpoint
ALTER TABLE subscription_links ADD CONSTRAINT subscription_links_one_target CHECK (num_nonnulls(asset_id, person_id) = 1);
--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_period_ck CHECK (period_months BETWEEN 1 AND 60);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON subscriptions TO tracknest_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON subscription_payments TO tracknest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON subscription_links TO tracknest_app;
--> statement-breakpoint
CREATE TRIGGER subscription_payments_append_only BEFORE UPDATE OR DELETE ON subscription_payments
  FOR EACH ROW EXECUTE FUNCTION history_is_append_only();
--> statement-breakpoint
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON subscriptions TO tracknest_app
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON subscription_payments TO tracknest_app
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE subscription_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON subscription_links TO tracknest_app
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
