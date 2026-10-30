CREATE TABLE "alert_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_log" ADD CONSTRAINT "alert_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_log_key_uq" ON "alert_log" USING btree ("org_id","key");--> statement-breakpoint
-- DELETE so a claim can be released when the email fails to send.
GRANT SELECT, INSERT, DELETE ON alert_log TO tracknest_app;
--> statement-breakpoint
ALTER TABLE alert_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON alert_log TO tracknest_app
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
