-- An admin can end (or restore) a delivery partner's posting.
--
-- The gap this closes: `admin_set_partner_canteen` onboards and transfers, and
-- `canteen_set_partner_active` retires — but only within `my_canteen_id()`, so it is the
-- canteen's own tool. After `harden_default_privileges.sql` the only UPDATE grant on
-- `delivery_partners` is `is_online`. An admin could therefore hire a partner and move
-- them between canteens, but never remove them from the platform.
--
-- The canteen id is a parameter rather than derived, unlike in the canteen function.
-- `delivery_partner_one_active_canteen` permits one active posting per person and
-- transfers leave the retired rows in place, so someone who has moved canteens has
-- several rows and "reactivate them" does not name one on its own.
--
-- Deactivating clears `is_online` for the same reason `canteen_set_partner_active` does:
-- a retired partner with a stale shift flag would otherwise still satisfy
-- `my_delivery_canteen_id()` and keep claiming.

create or replace function public.admin_set_partner_active(
  p_profile_id uuid,
  p_canteen_id uuid,
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

  -- Restoring a posting: retire any other live one first, so the one-active-canteen
  -- index still holds. Same order as admin_set_partner_canteen.
  if p_active then
    update public.delivery_partners
       set is_active = false, is_online = false
     where profile_id = p_profile_id and canteen_id <> p_canteen_id and is_active;
  end if;

  update public.delivery_partners
     set is_active = p_active,
         is_online = case when p_active then is_online else false end
   where profile_id = p_profile_id
     and canteen_id = p_canteen_id;

  -- Reached only when the pair does not exist. The retire above is rolled back with it,
  -- so a typo in the canteen id cannot silently strip someone of the posting they had.
  if not found then
    raise exception 'NOT_FOUND: no delivery partner % at canteen %', p_profile_id, p_canteen_id
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_set_partner_active(uuid, uuid, boolean) from public;
grant execute on function public.admin_set_partner_active(uuid, uuid, boolean) to authenticated;
