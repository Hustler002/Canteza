-- SECURITY FIX: take back the table privileges Supabase grants by default.
--
-- Supabase grants select, insert, update and delete on every table in `public` to
-- `anon` and `authenticated` when a project is created. Our whole authorization
-- model assumes the opposite -- that a column with no GRANT cannot be written,
-- because an RLS policy cannot restrict columns (see the grants block in the RLS
-- migration). Those two facts together are a privilege escalation:
--
--     update public.profiles set role = 'admin' where id = auth.uid();
--
-- `profiles_update_self` permits the row because it only checks ownership, and the
-- default grant supplies the column. A student makes themselves an admin. The same
-- shape lets a delivery partner set their own `is_approved`, `is_active` or
-- `canteen_id` through `delivery_partners_self_update`.
--
-- This was invisible to the test suite until the harness started modelling those
-- default privileges, because PGlite only ever had the grants our own migrations
-- wrote. supabase/test/rls.test.ts now proves the escalation is closed.
--
-- So: revoke everything from the two client-facing roles, stop future tables from
-- inheriting anything, then grant back exactly what the app needs. This also makes
-- the schema independent of which default-privilege behaviour a project was created
-- with -- the platform is changing it, and existing projects keep the permissive one.
--
-- `service_role` is left alone on purpose: it is server-side only (seeding, Edge
-- Functions) and never reaches a client bundle.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Functions are a different mechanism: Postgres grants EXECUTE to PUBLIC by default,
-- which this does NOT remove. That is deliberate. Verified empirically: revoking
-- is_admin()/my_canteen_id() from PUBLIC makes every policy that calls them fail with
-- "permission denied for function", because a policy expression is evaluated with the
-- querying user's function privileges. The helpers must stay callable.
--
-- They are safe to expose: each one reports only on the caller's own identity
-- (auth.uid()) or reads settings the client may already select. The function that is
-- NOT safe -- notify_order, which writes notification rows for arbitrary users -- was
-- already revoked from PUBLIC in the functions migration, and a test now pins that.
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- Future functions should not be reachable just because they exist.
alter default privileges in schema public revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- grants, restated
-- ---------------------------------------------------------------------------
-- This is now the authoritative list. The block in the RLS migration ran before the
-- revoke above, so it no longer has any effect; change privileges here.

grant usage on schema public to authenticated;

-- Reference data.
grant select on public.hostels, public.food_categories, public.canteens,
                public.canteens_public, public.canteen_staff, public.coupons,
                public.order_transitions, public.platform_settings
  to authenticated;

-- `role` is deliberately absent: a client may never promote itself.
grant select on public.profiles to authenticated;
grant update (full_name, phone, avatar_url,
              default_hostel_id, default_block, default_room) on public.profiles to authenticated;

-- `is_approved`, `is_active` and `canteen_id` are deliberately absent: a partner may
-- not approve themselves, un-deactivate themselves after their canteen lets them go,
-- or move themselves to a busier canteen. Those go through the admin/canteen functions.
grant select on public.delivery_partners to authenticated;
grant update (is_online) on public.delivery_partners to authenticated;

-- Orders are SELECT-only for every client, admins included. All movement goes
-- through place_order / transition_order / claim_delivery / release_delivery.
grant select on public.orders, public.order_items, public.order_status_history,
                public.payments, public.coupon_redemptions
  to authenticated;

grant select, insert, update, delete on public.menu_items to authenticated;
grant select, insert on public.reviews to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert on public.support_tickets to authenticated;

-- Admin management surfaces. RLS restricts these to admins; the grant only makes the
-- statement possible at all.
grant insert, update, delete on public.hostels, public.canteens, public.canteen_staff,
                                 public.food_categories, public.coupons to authenticated;
grant insert, update, delete on public.platform_settings to authenticated;
grant update on public.support_tickets to authenticated;
grant usage on sequence public.order_code_seq to authenticated;

-- ---------------------------------------------------------------------------
-- function execution
-- ---------------------------------------------------------------------------
-- Restated so the intended client surface is written down in one place, even though
-- the existing PUBLIC grant already covers most of these.

grant execute on function public.place_order(uuid, jsonb, uuid, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.transition_order(uuid, text, text) to authenticated;
grant execute on function public.claim_delivery(uuid) to authenticated;
grant execute on function public.release_delivery(uuid) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_set_partner_canteen(uuid, uuid, boolean) to authenticated;
grant execute on function public.canteen_set_partner_active(uuid, boolean) to authenticated;
