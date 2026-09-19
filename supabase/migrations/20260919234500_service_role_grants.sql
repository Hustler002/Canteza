-- Say out loud what `service_role` may do, instead of hoping the platform granted it.
--
-- Found the first time these migrations ran against a real Supabase project: every
-- server-side call failed with 42501, "permission denied for table profiles", and
-- PostgREST helpfully suggested the exact GRANT nobody had written. Not one table in
-- `public` was reachable by `service_role` -- seeding, and any Edge Function or scheduled
-- job that ever needs to bypass RLS, was dead on arrival.
--
-- Why it was invisible until then. `harden_default_privileges.sql` says service_role is
-- "left alone on purpose", meaning it was never revoked -- but nothing ever granted it
-- either. Supabase's bootstrap grants cover the tables that exist when a project is
-- created; ours are created afterwards by `supabase db push`, and evidently inherit
-- nothing. The PGlite harness then hid the gap by modelling a default privilege that
-- grants service_role on every new table, which this project does not do.
--
-- That is precisely the argument the hardening migration already makes for anon and
-- authenticated -- "this also makes the schema independent of which default-privilege
-- behaviour a project was created with" -- applied to the one role it left to chance.
--
-- `service_role` is safe to hand this: it is server-side only, never reaches a client
-- bundle, and already carries BYPASSRLS on Supabase. The thing protecting it is that the
-- key stays on a server, not that the grants are narrow.

grant usage on schema public to service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- And for everything a later migration adds, so this is not a chore to remember.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
