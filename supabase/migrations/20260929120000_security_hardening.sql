-- Security hardening before launch.
--
-- Found by attacking the live project with real sign-ins for every role (student,
-- canteen, delivery, admin, and no session at all): 83 attempts were refused, and these
-- are the ones that were not, plus what Supabase's security advisor reported.
--
--   1. A suspended account kept working. `my_canteen_id()` never looked at
--      `profiles.is_active`, so a counter worker an admin had suspended still read the
--      canteen's orders -- student names, phones, rooms -- and still edited its menu.
--      Supabase Auth knows nothing of `is_active` either, so they could still sign in.
--   2. A student could forge a complaint: `support_tickets` granted INSERT on every
--      column, so a ticket could arrive already `resolved`, carrying a `resolution` in
--      the admin's voice, and pinned to another student's order.
--   3. No free text had a length limit (a 200 KB name was accepted) and a picture link
--      took any scheme, `javascript:` included.
--   4. Nothing capped how many orders one account could have open. Sign-up is open and
--      cash needs no card, so one account could fill a counter's board.
--   5. Advisor: four functions with a mutable search_path, helper functions executable by
--      `anon`, the signup trigger function callable over RPC, and `canteens_public`
--      running as its owner when it has no reason to.

-- ---------------------------------------------------------------------------
-- 1. suspension means suspended
-- ---------------------------------------------------------------------------

-- The same shape as my_delivery_canteen_id(), which always required an active profile.
-- Every canteen policy and function keys off this, so one join closes every path:
-- orders, menu, the counterparty profiles, the partner roster, the pause switch.
create or replace function public.my_canteen_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cs.canteen_id
    from public.canteen_staff cs
    join public.profiles p on p.id = cs.profile_id
   where cs.profile_id = (select auth.uid())
     and p.is_active;
$$;

-- Every write to an order passes through here, whoever makes it: place_order,
-- transition_order, claim_delivery, and anything added later. A trigger rather than a
-- line in each function so a new path cannot forget it. `auth.uid()` is null for the
-- server's own work -- the payment webhook, the unpaid-order sweep -- which stays allowed.
create or replace function public.orders_refuse_suspended_actor() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is not null
     and not exists (select 1 from public.profiles where id = v_uid and is_active)
  then
    raise exception 'ACCOUNT_SUSPENDED: account %', v_uid using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger orders_refuse_suspended_actor
  before insert or update on public.orders
  for each row execute function public.orders_refuse_suspended_actor();

-- Suspending now also bans the account at Supabase Auth and ends its sessions, so the
-- person cannot sign in again and cannot refresh the token they hold. The access token
-- already issued lives until it expires (an hour by default), which is why the checks
-- above exist as well: until then it opens nothing that matters.
--
-- A hundred years rather than 'infinity': GoTrue reads `banned_until` into a Go time,
-- and the infinite timestamp is not one. It is the value GoTrue's own `ban_duration`
-- of 876000h writes. Restoring clears it.
create or replace function public.admin_set_profile_active(
  p_profile_id uuid,
  p_active     boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'P0001';
  end if;

  -- An admin suspending their own account would lock themselves out of the only place
  -- the suspension could be undone. The admin UI does not offer the control on your own
  -- row; this is the backstop for anything that skips the UI.
  if p_profile_id = (select auth.uid()) then
    raise exception 'FORBIDDEN: an admin cannot suspend their own account'
      using errcode = 'P0001';
  end if;

  update public.profiles set is_active = p_active where id = p_profile_id;

  if not found then
    raise exception 'NOT_FOUND: profile %', p_profile_id using errcode = 'P0001';
  end if;

  update auth.users
     set banned_until = case when p_active then null else now() + interval '100 years' end
   where id = p_profile_id;

  if not p_active then
    -- Refresh tokens hang off sessions and go with them.
    delete from auth.sessions where user_id = p_profile_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. a student writes a complaint, never its outcome
-- ---------------------------------------------------------------------------

-- Column grants, so `status` and `resolution` fall to their defaults on insert. The
-- table-wide UPDATE is narrowed the same way: an admin works a ticket by moving its
-- status and writing the answer, and never rewrites what the student said.
revoke insert, update on public.support_tickets from authenticated;
grant insert (student_id, order_id, subject, body) on public.support_tickets to authenticated;
grant update (status, resolution) on public.support_tickets to authenticated;

-- A complaint can name an order only if it is the complainant's own.
drop policy support_tickets_insert_own on public.support_tickets;
create policy support_tickets_insert_own on public.support_tickets
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (
      order_id is null
      or exists (
        select 1 from public.orders o
         where o.id = support_tickets.order_id and o.student_id = (select auth.uid())
      )
    )
  );

-- Reviews: the same narrowing. `id` and `created_at` are the database's to set.
revoke insert on public.reviews from authenticated;
grant insert (order_id, student_id, canteen_id, food_rating, delivery_rating, comment)
  on public.reviews to authenticated;

-- ---------------------------------------------------------------------------
-- 3. lengths and links
-- ---------------------------------------------------------------------------
-- The numbers are TEXT_LIMITS in packages/shared/src/limits.ts, which the forms read;
-- supabase/test/limits.test.ts fails if the two disagree. Every row on the live project
-- fitted inside them when this was written.

alter table public.profiles
  add constraint profiles_full_name_len check (char_length(full_name) <= 80),
  add constraint profiles_phone_len check (char_length(phone) <= 20),
  add constraint profiles_default_block_len check (char_length(default_block) <= 20),
  add constraint profiles_default_room_len check (char_length(default_room) <= 20),
  add constraint profiles_avatar_url_https check (
    char_length(avatar_url) <= 2048 and avatar_url ~* '^https://[^[:space:]/?#]+[^[:space:]]*$'
  );

alter table public.orders
  add constraint orders_block_len check (char_length(block) <= 20),
  add constraint orders_room_len check (char_length(room) <= 20),
  add constraint orders_delivery_note_len check (char_length(delivery_note) <= 300),
  add constraint orders_cancellation_reason_len check (char_length(cancellation_reason) <= 300),
  add constraint orders_idempotency_key_len check (char_length(idempotency_key) <= 100);

alter table public.order_status_history
  add constraint order_status_history_reason_len check (char_length(reason) <= 300);

alter table public.support_tickets
  add constraint support_tickets_subject_len check (char_length(subject) <= 120),
  add constraint support_tickets_body_len check (char_length(body) <= 2000),
  add constraint support_tickets_resolution_len check (char_length(resolution) <= 2000);

alter table public.reviews
  add constraint reviews_comment_len check (char_length(comment) <= 1000);

alter table public.canteens
  add constraint canteens_name_len check (char_length(name) <= 80),
  add constraint canteens_description_len check (char_length(description) <= 500),
  add constraint canteens_phone_len check (char_length(phone) <= 20),
  add constraint canteens_image_url_https check (
    char_length(image_url) <= 2048 and image_url ~* '^https://[^[:space:]/?#]+[^[:space:]]*$'
  );

alter table public.menu_items
  add constraint menu_items_name_len check (char_length(name) <= 80),
  add constraint menu_items_description_len check (char_length(description) <= 500),
  add constraint menu_items_image_url_https check (
    char_length(image_url) <= 2048 and image_url ~* '^https://[^[:space:]/?#]+[^[:space:]]*$'
  );

alter table public.hostels
  add constraint hostels_name_len check (char_length(name) <= 80);

alter table public.coupons
  add constraint coupons_code_len check (char_length(code) <= 40);

-- ---------------------------------------------------------------------------
-- 4. how many orders one student may have open
-- ---------------------------------------------------------------------------
-- PLATFORM_DEFAULTS.maxOpenOrdersPerStudent; a `max_open_orders_per_student` row in
-- platform_settings overrides it. place_order answers a retry with the existing order
-- before it inserts, so a double tap never counts twice.
--
-- Only orders placed in the last 12 hours count. A flood needs volume now, and nothing
-- sweeps an unpaid-for cash order a canteen simply never answered -- without the window,
-- five of those would lock a student out for good.

create or replace function public.orders_limit_open_per_student() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.orders o
     where o.student_id = new.student_id
       and o.status not in ('delivered', 'cancelled', 'rejected')
       and o.created_at > now() - interval '12 hours'
  ) >= public.setting_int('max_open_orders_per_student', 5) then
    raise exception 'TOO_MANY_OPEN_ORDERS: student % has too many open orders', new.student_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger orders_limit_open_per_student
  before insert on public.orders
  for each row execute function public.orders_limit_open_per_student();

-- ---------------------------------------------------------------------------
-- 5. advisor findings
-- ---------------------------------------------------------------------------

alter function public.touch_updated_at() set search_path = '';
alter function public.is_within_hours(time, time, time) set search_path = '';
alter function public.campus_now() set search_path = '';
alter function public.release_delivery(uuid) set search_path = '';

-- Trigger functions are never meant to be called over RPC. Postgres checks EXECUTE on a
-- trigger function when the trigger is created, not each time it fires, so this does
-- not stop the triggers themselves.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.orders_refuse_suspended_actor() from public, anon, authenticated;
revoke execute on function public.orders_limit_open_per_student() from public, anon, authenticated;

-- The RLS helpers answer "who am I" and are only meaningful with a session. `anon` has no
-- table grants, so no policy ever evaluates them for it; they were executable only
-- because Postgres grants EXECUTE to PUBLIC by default.
revoke execute on function public.auth_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.my_canteen_id() from public, anon;
revoke execute on function public.my_delivery_canteen_id() from public, anon;
revoke execute on function public.is_delivery_partner() from public, anon;
revoke execute on function public.setting_int(text, integer) from public, anon;
grant execute on function public.auth_role() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.my_canteen_id() to authenticated, service_role;
grant execute on function public.my_delivery_canteen_id() to authenticated, service_role;
grant execute on function public.is_delivery_partner() to authenticated, service_role;
grant execute on function public.setting_int(text, integer) to authenticated, service_role;

-- `canteens_public` filters `is_active` itself and `canteens_read` lets any signed-in
-- user read active canteens, so running as the caller changes no result -- it only
-- stops the view being a way round RLS if either ever changes. `canteen_stats` stays a
-- definer view on purpose; see its own migration.
alter view public.canteens_public set (security_invoker = true);
