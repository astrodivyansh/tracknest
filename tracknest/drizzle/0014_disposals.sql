ALTER TABLE "assets" ADD COLUMN "disposed_on" date;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "disposal_method" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "disposal_value" numeric(12, 2);