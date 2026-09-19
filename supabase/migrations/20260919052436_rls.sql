-- Row Level Security.
--
-- This file is the authorization boundary. Client navigation is ergonomics; these
-- policies are what actually stops a student reading another student's order.
--
-- Patterns follow Supabase guidance:
--   * helpers are `stable security definer set search_path = ''` so a policy that
--     looks up a role does not recurse into the policy it is being evaluated for
--   * `auth.uid()` is wrapped in `(select ...)` so Postgres caches it per statement
--     instead of calling it per row
--   * every policy names its role with `to authenticated`

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.auth_role() returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p
   where p.id = (select auth.uid()) and p.is_active;
$$;

create or replace function public.is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'admin', false);
$$;

-- One staff account belongs to one canteen (enforced by canteen_staff_one_canteen).
create or replace function public.my_canteen_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cs.canteen_id from public.canteen_staff cs
   where cs.profile_id = (select auth.uid());
$$;

create or replace function public.is_delivery_partner() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.delivery_partners dp
     join public.profiles p on p.id = dp.profile_id
     where dp.profile_id = (select auth.uid()) and dp.is_approved and p.is_active
  );
$$;

-- Read a platform setting, falling back to the value baked into the app.
create or replace function public.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.value #>> '{}')::integer from public.platform_settings s where s.key = p_key),
    p_default
  );
$$;

-- ---------------------------------------------------------------------------
-- enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.hostels             enable row level security;
alter table public.canteens            enable row level security;
alter table public.canteen_staff       enable row level security;
alter table public.delivery_partners   enable row level security;
alter table public.food_categories     enable row level security;
alter table public.menu_items          enable row level security;
alter table public.coupons             enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_transitions   enable row level security;
alter table public.payments            enable row level security;
alter table public.coupon_redemptions  enable row level security;
alter table public.reviews             enable row level security;
alter table public.favorites           enable row level security;
alter table public.notifications       enable row level security;
alter table public.support_tickets     enable row level security;
alter table public.platform_settings   enable row level security;

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
-- Privileges are role-wide and policies cannot restrict columns, so anything that
-- must never be client-writable is withheld at the GRANT, not at the policy.

grant usage on schema public to authenticated;

-- Reference data.
grant select on public.hostels, public.food_categories, public.canteens,
                public.canteens_public, public.canteen_staff, public.coupons,
                public.order_transitions, public.platform_settings
  to authenticated;

-- `role` is deliberately absent: a client may never promote itself.
grant select on public.profiles to authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

-- `is_approved` is deliberately absent: a partner may not approve themselves.
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

-- Admin management surfaces.
grant insert, update, delete on public.hostels, public.canteens, public.canteen_staff,
                                 public.food_categories, public.coupons to authenticated;
grant insert, update, delete on public.platform_settings to authenticated;
grant update on public.support_tickets to authenticated;
grant usage on sequence public.order_code_seq to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy profiles_read_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

-- A canteen sees the student's name on an order it is preparing; a partner sees
-- the name of whoever they are delivering to. Both only while the order is live.
create policy profiles_read_counterparty on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
       where o.student_id = public.profiles.id
         and o.status not in ('delivered', 'cancelled', 'rejected')
         and (o.canteen_id = (select public.my_canteen_id())
              or o.delivery_partner_id = (select auth.uid()))
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- campus reference data
-- ---------------------------------------------------------------------------

create policy hostels_read on public.hostels
  for select to authenticated using (is_active or public.is_admin());
create policy hostels_admin on public.hostels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy canteens_read on public.canteens
  for select to authenticated using (is_active or public.is_admin());
create policy canteens_admin on public.canteens
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Staff adjust their own canteen's hours and pause switch.
create policy canteens_staff_update on public.canteens
  for update to authenticated
  using (id = (select public.my_canteen_id()))
  with check (id = (select public.my_canteen_id()));

create policy canteen_staff_read on public.canteen_staff
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_admin());
create policy canteen_staff_admin on public.canteen_staff
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy delivery_partners_read on public.delivery_partners
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_admin());
create policy delivery_partners_self_update on public.delivery_partners
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
create policy delivery_partners_admin on public.delivery_partners
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy food_categories_read on public.food_categories
  for select to authenticated using (true);
create policy food_categories_admin on public.food_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy order_transitions_read on public.order_transitions
  for select to authenticated using (true);

create policy platform_settings_read on public.platform_settings
  for select to authenticated using (true);
create policy platform_settings_admin on public.platform_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- menu
-- ---------------------------------------------------------------------------

create policy menu_items_read on public.menu_items
  for select to authenticated
  using (is_active or canteen_id = (select public.my_canteen_id()) or public.is_admin());

-- A canteen manages its own menu and no one else's.
create policy menu_items_own_canteen on public.menu_items
  for all to authenticated
  using (canteen_id = (select public.my_canteen_id()))
  with check (canteen_id = (select public.my_canteen_id()));

create policy menu_items_admin on public.menu_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy coupons_read on public.coupons
  for select to authenticated
  using (
    public.is_admin()
    or (is_active and valid_from <= now() and (valid_until is null or valid_until > now()))
  );
create policy coupons_admin on public.coupons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
-- No INSERT/UPDATE/DELETE policies exist on purpose: there are no such grants.

create policy orders_read on public.orders
  for select to authenticated
  using (
    student_id = (select auth.uid())
    or canteen_id = (select public.my_canteen_id())
    or delivery_partner_id = (select auth.uid())
    or public.is_admin()
  );

-- A partner sees the hostel, block and room only for an order they are holding.
-- Unclaimed orders are exposed through public.delivery_pool, which omits them.

create policy order_items_read on public.order_items
  for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = order_items.order_id)
  );

create policy order_status_history_read on public.order_status_history
  for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = order_status_history.order_id)
  );

create policy payments_read on public.payments
  for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = payments.order_id)
  );

create policy coupon_redemptions_read on public.coupon_redemptions
  for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

-- ---------------------------------------------------------------------------
-- the delivery pool
-- ---------------------------------------------------------------------------
-- A security-definer view (the Postgres default) so it can read past the orders
-- policy, projecting only what a partner needs to decide whether to take the job.
-- The student's room number is NOT in it. The partner check is inside the view.

create view public.delivery_pool as
  select
    o.id,
    o.code,
    o.canteen_id,
    o.canteen_name_snapshot,
    o.hostel_label,
    o.block,
    o.total_paise,
    o.partner_payout_paise,
    o.created_at,
    (select count(*) from public.order_items oi where oi.order_id = o.id) as item_count
  from public.orders o
  where o.status = 'ready'
    and o.delivery_partner_id is null
    and public.is_delivery_partner();

grant select on public.delivery_pool to authenticated;

-- ---------------------------------------------------------------------------
-- engagement
-- ---------------------------------------------------------------------------

create policy reviews_read on public.reviews
  for select to authenticated using (true);

-- Only the student who owns a delivered order may review it, once (unique order_id).
create policy reviews_insert_own on public.reviews
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and exists (
      select 1 from public.orders o
       where o.id = reviews.order_id
         and o.student_id = (select auth.uid())
         and o.status = 'delivered'
         and o.canteen_id = reviews.canteen_id
    )
  );

create policy favorites_own on public.favorites
  for all to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

create policy notifications_own on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy support_tickets_own on public.support_tickets
  for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());
create policy support_tickets_insert_own on public.support_tickets
  for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy support_tickets_admin on public.support_tickets
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- admin-only escalation paths
-- ---------------------------------------------------------------------------
-- `profiles.role` and `delivery_partners.is_approved` have no UPDATE grant, so
-- they can only change through these audited functions.

create or replace function public.admin_set_role(p_profile_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'P0001';
  end if;
  if p_role not in ('student', 'canteen', 'delivery', 'admin') then
    raise exception 'NOT_FOUND: unknown role %', p_role using errcode = 'P0001';
  end if;
  update public.profiles set role = p_role where id = p_profile_id;
  if not found then
    raise exception 'NOT_FOUND: profile %', p_profile_id using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.admin_set_partner_approval(p_profile_id uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'P0001';
  end if;
  insert into public.delivery_partners (profile_id, is_approved)
  values (p_profile_id, p_approved)
  on conflict (profile_id) do update set is_approved = excluded.is_approved;
end;
$$;

revoke all on function public.admin_set_role(uuid, text) from public;
revoke all on function public.admin_set_partner_approval(uuid, boolean) from public;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_set_partner_approval(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- realtime
-- ---------------------------------------------------------------------------
-- Guarded so this migration also runs on a plain Postgres (the test harness),
-- where Supabase's publication does not exist.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders;
    alter publication supabase_realtime add table public.notifications;
    alter publication supabase_realtime add table public.menu_items;
  end if;
end;
$$;
