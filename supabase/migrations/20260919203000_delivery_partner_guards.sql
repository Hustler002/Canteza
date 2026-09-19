-- Three corrections to `admin_set_partner_canteen`, all found while building the admin
-- UI for it. The transfer behaviour itself is unchanged.
--
-- 1. It required the canteen to be `is_active`. Since `admin_create_canteen` deliberately
--    creates a canteen switched off — so its staff and menu can go in before students see
--    it — that made the intended order of work impossible: counter staff could be attached
--    to a new canteen but delivery staff could not. The canteen must exist; it need not be
--    live. `admin_attach_canteen_staff` already works this way.
--
-- 2. It had no guard against onboarding someone who is canteen staff. The reverse guard
--    exists (`admin_attach_canteen_staff` raises ALREADY_DELIVERY_PARTNER), so the broken
--    pairing was simply reachable from the other side. `transition_order` resolves the
--    actor admin -> canteen -> delivery, so a person holding both rows acts as 'canteen'
--    on their own canteen's orders: they can claim a delivery and then never mark it
--    picked up, because ready -> picked_up is not a canteen transition.
--
-- 3. It set `profiles.role = 'delivery'` unconditionally, which would quietly strip the
--    dashboard from an admin who was also put on a delivery roster. Same guard as the
--    canteen staff functions now carry.

create or replace function public.admin_set_partner_canteen(
  p_profile_id uuid,
  p_canteen_id uuid,
  p_approved   boolean default true
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

  -- Exists, not necessarily live: a canteen is staffed before it is enabled.
  if not exists (select 1 from public.canteens where id = p_canteen_id) then
    raise exception 'NOT_FOUND: canteen %', p_canteen_id using errcode = 'P0001';
  end if;

  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception 'NOT_FOUND: profile %', p_profile_id using errcode = 'P0001';
  end if;

  if exists (select 1 from public.canteen_staff cs where cs.profile_id = p_profile_id) then
    raise exception 'ALREADY_CANTEEN_STAFF: profile % works a counter', p_profile_id
      using errcode = 'P0001';
  end if;

  -- Deactivating any previous posting keeps delivery_partner_one_active_canteen
  -- satisfied and leaves the old row in place so historical orders still resolve.
  update public.delivery_partners
     set is_active = false, is_online = false
   where profile_id = p_profile_id and canteen_id <> p_canteen_id and is_active;

  insert into public.delivery_partners (profile_id, canteen_id, is_approved, is_active)
  values (p_profile_id, p_canteen_id, p_approved, true)
  on conflict (profile_id, canteen_id)
    do update set is_approved = excluded.is_approved, is_active = true;

  -- Never demote an admin who also carries food.
  if v_role <> 'admin' then
    update public.profiles set role = 'delivery' where id = p_profile_id;
  end if;
end;
$$;
