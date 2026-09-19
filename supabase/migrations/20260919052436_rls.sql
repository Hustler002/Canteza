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

-- The canteen this partner delivers for, or null if the caller is not a working
-- partner. Delivery authorization is canteen-scoped (ADR 008), so almost everything
-- the delivery app can see keys off this one value.
create or replace function public.my_delivery_canteen_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select dp.canteen_id
    from public.delivery_partners dp
    join public.profiles p on p.id = dp.profile_id
   where dp.profile_id = (select auth.uid())
     and dp.is_approved and dp.is_active and p.is_active;
$$;

create or replace function public.is_delivery_partner() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_delivery_canteen_id() is not null;
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

-- `is_approved`, `is_active` and `canteen_id` are deliberately absent: a partner may
-- not approve themselves, un-deactivate themselves after their canteen lets them go,
-- or move themselves to a busier canteen. Those go through the functions below.
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
  using (id = (select auth.uid()) or (select public.is_admin()));

-- Everyone working on a live order can see the name of everyone else on it, and
-- nothing beyond that. Once the order is terminal the mutual visibility ends.
--
--   canteen  <-> student        (who ordered)
--   partner  <-> student        (whose door)
--   canteen  <-> its partner    (which of my staff is carrying it)
--   student  <-> the partner    ("Vikram is bringing your order")
create policy profiles_read_counterparty on public.profiles
  for select to authenticated
  using (
    -- The student on an order I am the canteen for, or am delivering.
    exists (
      select 1 from public.orders o
       where o.student_id = public.profiles.id
         and o.status not in ('delivered', 'cancelled', 'rejected')
         and (o.canteen_id = (select public.my_canteen_id())
              or o.delivery_partner_id = (select auth.uid()))
    )
    -- The partner carrying an order I am the canteen for, or that I placed.
    or exists (
      select 1 from public.orders o
       where o.delivery_partner_id = public.profiles.id
         and o.status not in ('delivered', 'cancelled', 'rejected')
         and (o.canteen_id = (select public.my_canteen_id())
              or o.student_id = (select auth.uid()))
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
  for select to authenticated using (is_active or (select public.is_admin()));
create policy hostels_admin on public.hostels
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy canteens_read on public.canteens
  for select to authenticated using (is_active or (select public.is_admin()));
create policy canteens_admin on public.canteens
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
-- Staff adjust their own canteen's hours and pause switch.
create policy canteens_staff_update on public.canteens
  for update to authenticated
  using (id = (select public.my_canteen_id()))
  with check (id = (select public.my_canteen_id()));

create policy canteen_staff_read on public.canteen_staff
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));
create policy canteen_staff_admin on public.canteen_staff
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- A canteen sees its own delivery staff; a partner sees their own record.
create policy delivery_partners_read on public.delivery_partners
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or canteen_id = (select public.my_canteen_id())
    or (select public.is_admin())
  );
-- The partner's shift toggle. `is_active` and `is_approved` have no grant, so this
-- can only ever change is_online.
create policy delivery_partners_self_update on public.delivery_partners
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
create policy delivery_partners_admin on public.delivery_partners
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy food_categories_read on public.food_categories
  for select to authenticated using (true);
create policy food_categories_admin on public.food_categories
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy order_transitions_read on public.order_transitions
  for select to authenticated using (true);

create policy platform_settings_read on public.platform_settings
  for select to authenticated using (true);
create policy platform_settings_admin on public.platform_settings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- menu
-- ---------------------------------------------------------------------------

create policy menu_items_read on public.menu_items
  for select to authenticated
  using (is_active or canteen_id = (select public.my_canteen_id()) or (select public.is_admin()));

-- A canteen manages its own menu and no one else's.
create policy menu_items_own_canteen on public.menu_items
  for all to authenticated
  using (canteen_id = (select public.my_canteen_id()))
  with check (canteen_id = (select public.my_canteen_id()));

create policy menu_items_admin on public.menu_items
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy coupons_read on public.coupons
  for select to authenticated
  using (
    (select public.is_admin())
    or (is_active and valid_from <= now() and (valid_until is null or valid_until > now()))
  );
create policy coupons_admin on public.coupons
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

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
    -- A partner sees their own canteen's queue of unclaimed ready orders, and nothing
    -- else. No other canteen's orders are visible at any status.
    or (status = 'ready'
        and delivery_partner_id is null
        and canteen_id = (select public.my_delivery_canteen_id()))
    or (select public.is_admin())
  );

-- Room-level delivery is the product, so a partner gets the full destination
-- (hostel, block, room, instructions) for their own canteen's orders. They are that
-- canteen's staff, not an anonymous courier.

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
  using (student_id = (select auth.uid()) or (select public.is_admin()));

-- The campus-wide `delivery_pool` view that used to live here is gone. It existed to
-- show unclaimed work across every canteen while hiding the student's room. Now that a
-- partner is a specific canteen's employee, the orders policy above scopes the queue
-- correctly on its own, and the partner legitimately needs the full address. One fewer
-- object to keep in step with the table it projected.

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
  using (student_id = (select auth.uid()) or (select public.is_admin()));
create policy support_tickets_insert_own on public.support_tickets
  for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy support_tickets_admin on public.support_tickets
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

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

-- Onboard a delivery partner to a canteen, or move an existing one. Deactivating any
-- previous posting keeps delivery_partner_one_active_canteen satisfied and leaves the
-- old row in place so historical orders still resolve.
create or replace function public.admin_set_partner_canteen(
  p_profile_id uuid,
  p_canteen_id uuid,
  p_approved   boolean default true
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.canteens where id = p_canteen_id and is_active) then
    raise exception 'NOT_FOUND: canteen %', p_canteen_id using errcode = 'P0001';
  end if;

  update public.delivery_partners
     set is_active = false, is_online = false
   where profile_id = p_profile_id and canteen_id <> p_canteen_id and is_active;

  insert into public.delivery_partners (profile_id, canteen_id, is_approved, is_active)
  values (p_profile_id, p_canteen_id, p_approved, true)
  on conflict (profile_id, canteen_id)
    do update set is_approved = excluded.is_approved, is_active = true;

  update public.profiles set role = 'delivery' where id = p_profile_id;
end;
$$;

-- A canteen retires its own departed staff without waiting for an admin. It cannot
-- reach another canteen's partners, and cannot approve anyone.
create or replace function public.canteen_set_partner_active(
  p_profile_id uuid,
  p_active     boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canteen uuid := public.my_canteen_id();
begin
  if v_canteen is null then
    raise exception 'FORBIDDEN: canteen staff only' using errcode = 'P0001';
  end if;

  -- Scoped to this canteen's own posting. An admin uses admin_set_partner_canteen.
  update public.delivery_partners
     set is_active = p_active,
         is_online = case when p_active then is_online else false end
   where profile_id = p_profile_id
     and canteen_id = v_canteen;

  if not found then
    raise exception 'NOT_FOUND: no delivery partner % at this canteen', p_profile_id
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_set_role(uuid, text) from public;
revoke all on function public.admin_set_partner_canteen(uuid, uuid, boolean) from public;
revoke all on function public.canteen_set_partner_active(uuid, boolean) from public;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_set_partner_canteen(uuid, uuid, boolean) to authenticated;
grant execute on function public.canteen_set_partner_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- realtime
-- ---------------------------------------------------------------------------
-- Guarded so this migration also runs on a plain Postgres (the test harness),
-- where Supabase's publication does not exist.

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  -- Adding a table that is already a member raises, which would fail the whole
  -- migration on a database where the publication was pre-populated.
  foreach v_table in array array['orders', 'notifications', 'menu_items'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
