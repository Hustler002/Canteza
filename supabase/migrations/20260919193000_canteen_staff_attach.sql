-- Attaching and detaching canteen staff.
--
-- Two things have to move together. `my_canteen_id()` reads `canteen_staff` and never
-- looks at `profiles.role`, so the row is what actually grants canteen powers in the
-- database — while `role` is what decides which app the person lands in. Writing one
-- without the other gives someone either a counter screen with no data, or a canteen's
-- data behind a student's menu. `profiles.role` has no client grant at all, so this has
-- to be a `security definer` function regardless.
--
-- Attaching deliberately does NOT require the canteen to be active: a canteen is created
-- disabled precisely so its staff and menu can be put in place before students see it.

create or replace function public.admin_attach_canteen_staff(
  p_profile_id uuid,
  p_canteen_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.canteens where id = p_canteen_id) then
    raise exception 'NOT_FOUND: canteen %', p_canteen_id using errcode = 'P0001';
  end if;

  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception 'NOT_FOUND: profile %', p_profile_id using errcode = 'P0001';
  end if;

  -- `transition_order` resolves the actor admin -> canteen -> delivery, so someone who
  -- is both would always act as 'canteen' on their own canteen's orders. They could
  -- claim a delivery and then never mark it picked up, because ready -> picked_up is not
  -- a canteen transition: stuck holding the food. Refuse the combination outright.
  if exists (
    select 1 from public.delivery_partners dp
     where dp.profile_id = p_profile_id and dp.is_active
  ) then
    raise exception 'ALREADY_DELIVERY_PARTNER: profile % still has a delivery posting',
      p_profile_id using errcode = 'P0001';
  end if;

  -- A transfer. `canteen_staff_one_canteen` allows one row per person, and unlike
  -- `delivery_partners` nothing historical points at it -- an order records its
  -- `canteen_id`, not who was on the counter -- so the old row is simply removed.
  delete from public.canteen_staff where profile_id = p_profile_id;

  insert into public.canteen_staff (canteen_id, profile_id)
  values (p_canteen_id, p_profile_id);

  -- Never demote an admin who also works a counter: they would lose the dashboard.
  if v_role <> 'admin' then
    update public.profiles set role = 'canteen' where id = p_profile_id;
  end if;
end;
$$;

create or replace function public.admin_detach_canteen_staff(
  p_profile_id uuid,
  p_canteen_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'P0001';
  end if;

  delete from public.canteen_staff
   where profile_id = p_profile_id and canteen_id = p_canteen_id;

  if not found then
    raise exception 'NOT_FOUND: % is not staff at canteen %', p_profile_id, p_canteen_id
      using errcode = 'P0001';
  end if;

  -- Back to where every account starts. Guarded on the current value for two reasons:
  -- an admin must not be demoted by losing a counter posting, and a delivery partner
  -- would not be one of these rows in the first place.
  update public.profiles set role = 'student'
   where id = p_profile_id and role = 'canteen';
end;
$$;

-- ---------------------------------------------------------------------------
-- canteen_staff joins the RPC-only tables
-- ---------------------------------------------------------------------------
-- The blanket grant is now unused: these two functions are the only way a membership
-- changes, and they are the only place that keeps `profiles.role` in step with it. A
-- direct insert would leave the role behind. Seeding is unaffected -- seed-users.mjs
-- writes as `service_role`, which this does not touch.
revoke insert, update, delete on public.canteen_staff from authenticated;

revoke all on function public.admin_attach_canteen_staff(uuid, uuid) from public;
revoke all on function public.admin_detach_canteen_staff(uuid, uuid) from public;
grant execute on function public.admin_attach_canteen_staff(uuid, uuid) to authenticated;
grant execute on function public.admin_detach_canteen_staff(uuid, uuid) to authenticated;
