-- App role: the web app connects as this role. It is not the table owner,
-- so Row-Level Security always applies to it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tracknest_app') THEN
    CREATE ROLE tracknest_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO tracknest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, sessions TO tracknest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sites, locations, categories, departments, persons, assets TO tracknest_app;
--> statement-breakpoint
-- Custody history: checkouts can be closed but never deleted; events are insert-only.
GRANT SELECT, INSERT, UPDATE ON checkouts TO tracknest_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON asset_events TO tracknest_app;
--> statement-breakpoint

-- Tenant isolation: each request sets app.org_id inside its transaction.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','locations','categories','departments','persons','assets','checkouts','asset_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO tracknest_app
         USING (org_id = current_setting(''app.org_id'', true)::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'', true)::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- A checkout row may only be closed once; who/what/when of the hand-out never changes.
CREATE FUNCTION checkouts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'open' THEN
    RAISE EXCEPTION 'checkout % is closed and cannot be changed', OLD.id;
  END IF;
  IF NEW.asset_id <> OLD.asset_id OR NEW.org_id <> OLD.org_id
     OR NEW.holder_type <> OLD.holder_type OR NEW.holder_id <> OLD.holder_id
     OR NEW.holder_name <> OLD.holder_name OR NEW.checked_out_by <> OLD.checked_out_by
     OR NEW.checked_out_at <> OLD.checked_out_at
     OR NEW.out_condition IS DISTINCT FROM OLD.out_condition
     OR NEW.out_notes IS DISTINCT FROM OLD.out_notes THEN
    RAISE EXCEPTION 'check-out details of % cannot be changed', OLD.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER checkouts_guard BEFORE UPDATE ON checkouts
  FOR EACH ROW EXECUTE FUNCTION checkouts_guard();
--> statement-breakpoint

-- Belt and braces: even the table owner cannot rewrite or delete history.
CREATE FUNCTION history_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: history is append-only', TG_OP, TG_TABLE_NAME;
END $$;
--> statement-breakpoint
CREATE TRIGGER asset_events_append_only BEFORE UPDATE OR DELETE ON asset_events
  FOR EACH ROW EXECUTE FUNCTION history_is_append_only();
--> statement-breakpoint
CREATE TRIGGER checkouts_no_delete BEFORE DELETE ON checkouts
  FOR EACH ROW EXECUTE FUNCTION history_is_append_only();
