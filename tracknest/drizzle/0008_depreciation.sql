ALTER TABLE "categories" ADD COLUMN "dep_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "dep_life_years" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "dep_rate_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "dep_salvage_pct" numeric(5, 2);