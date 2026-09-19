-- Creating a canteen, and closing the last two blanket grants on the table.
--
-- A new canteen starts `is_active = false`. The column default is true, and a canteen
-- is visible to students through `canteens_public` the instant it exists — so with the
-- default it would appear in everyone's list on day one with an empty menu and no staff
-- to cook anything. Same shape as a new delivery posting starting off shift: the thing
-- is created, then the person responsible turns it on.
--
-- `is_accepting_orders` keeps its default of true. It is the counter's pause switch and
-- means nothing while `is_active` is false, so the canteen simply works the moment an
-- admin enables it.
create or replace function public.admin_create_canteen(
  p_name            text,
  p_description     text,
  p_phone           text,
  p_image_url       text,
  p_min_order_paise integer,
  p_opens_at        time,
  p_closes_at       time
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'NOT_FOUND: a canteen needs a name' using errcode = 'P0001';
  end if;

  -- A duplicate name surfaces as the unique violation on canteens_name_key, which the
  -- admin app turns into "Another canteen already has that name" — the same path the
  -- edit form already uses. No new error code for what a constraint already says.
  insert into public.canteens
    (name, description, phone, image_url, min_order_paise, opens_at, closes_at, is_active)
  values
    (trim(p_name), coalesce(p_description, ''), p_phone, p_image_url,
     coalesce(p_min_order_paise, 0), p_opens_at, p_closes_at, false)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- canteens is now RPC-only for writes, apart from the three staff columns
-- ---------------------------------------------------------------------------
-- INSERT had exactly one consumer, a direct insert from the admin app, and that is now
-- admin_create_canteen. DELETE never had one: nothing operational is hard-deleted here
-- (context.md §5). A canteen row is referenced by every order ever placed at it, and
-- `canteen_staff` and `delivery_partners` cascade from it — deleting one would take the
-- staff and partner rows with it and leave `orders.canteen_id` pointing at nothing.
-- Retiring a canteen is `admin_set_canteen_active(id, false)`, which keeps all of it.
--
-- `canteens_admin` already refused both to non-admins; this makes them impossible for
-- everyone, which is the rule-8 shape: withheld at the grant, not filtered by a policy.
revoke insert, delete on public.canteens from authenticated;

revoke all on function public.admin_create_canteen(text, text, text, text, integer, time, time)
  from public;
grant execute on function public.admin_create_canteen(text, text, text, text, integer, time, time)
  to authenticated;
