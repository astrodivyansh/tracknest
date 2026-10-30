CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_org_idx" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "login_failures_email_idx" ON "login_failures" USING btree ("email","at");--> statement-breakpoint
CREATE INDEX "login_failures_ip_idx" ON "login_failures" USING btree ("ip","at");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invites, login_failures TO tracknest_app;
