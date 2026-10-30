ALTER TABLE "organizations" ADD COLUMN "setup_step" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "suite" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "country" text;
--> statement-breakpoint
-- Organizations that already exist have set themselves up; only new ones see the wizard.
UPDATE "organizations" SET "setup_step" = 9;
