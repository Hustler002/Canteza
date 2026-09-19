-- Suspending an account, and closing the last hard-delete.
--
-- `profiles.is_active` has gated access since Phase 2 — `my_delivery_canteen_id()` joins
-- profiles and requires it — but nothing could ever write it. The hardening migration
-- grants `update (full_name, phone, avatar_url, default_hostel_id, default_block,
-- default_room)` and no function touched the column, so the control existed on paper
-- only. This makes it real, and admin-only, because suspending an account is not
-- something an account should be able to do to itself or anyone else.

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
end;
$$;

-- The same trap, one step further along: an admin who demotes themselves cannot promote
-- themselves back, and if they were the only admin nobody can. Every other function that
-- writes `role` already refuses to demote an admin; this one wrote whatever it was given,
-- and the students page is the first screen that makes that reachable.
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

  if p_profile_id = (select auth.uid()) and p_role <> 'admin' then
    raise exception 'FORBIDDEN: an admin cannot demote themselves'
      using errcode = 'P0001';
  end if;

  update public.profiles set role = p_role where id = p_profile_id;
  if not found then
    raise exception 'NOT_FOUND: profile %', p_profile_id using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- hostels: disabled, never deleted
-- ---------------------------------------------------------------------------
-- INSERT and UPDATE stay as direct writes: `hostels_admin` is the only policy offering a
-- WITH CHECK, no other role writes this table, and there is no column here that needs
-- withholding — so a grant plus a policy says everything an RPC would.
--
-- DELETE is different. `orders.hostel_id` has no ON DELETE clause, so Postgres refuses to
-- remove a hostel that has orders — but one without orders would vanish cleanly, and
-- `profiles.default_hostel_id` is ON DELETE SET NULL, so every student who lives there
-- silently loses their saved address. Disabling keeps the building, its name on old
-- orders, and those addresses.
revoke delete on public.hostels from authenticated;

revoke all on function public.admin_set_profile_active(uuid, boolean) from public;
grant execute on function public.admin_set_profile_active(uuid, boolean) to authenticated;
