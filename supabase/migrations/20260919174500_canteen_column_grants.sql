-- Canteen staff may change their hours and their pause switch. Nothing else.
--
-- `canteens_staff_update` says exactly that in its comment, but the grant behind it was
-- table-wide: `grant insert, update, delete on public.canteens to authenticated`. A
-- policy cannot restrict columns (rule 8), so the comment was the only thing stopping a
-- canteen account from renaming itself, changing its own minimum order, or setting
-- `is_active = false` and vanishing from every student's list.
--
-- Column grants are per *role*, and admins and canteen staff are both `authenticated` —
-- there is no separate admin role in Postgres to grant more to. So restricting the
-- column list necessarily restricts admins too, and the admin's own writes move into
-- `security definer` functions, which is where every other admin-only path in this
-- schema already lives (`admin_set_role`, `admin_set_partner_canteen`).
--
-- INSERT and DELETE are left alone: those are whole-row operations, so `canteens_admin`
-- is the only policy that offers a WITH CHECK for them and a non-admin is already
-- refused. It is only UPDATE that needed columns.

revoke update on public.canteens from authenticated;

-- The staff surface, in full. Widening it is a one-line change here — and it has to be
-- here, not in the RLS migration, which the hardening revoke supersedes.
grant update (opens_at, closes_at, is_accepting_orders) on public.canteens to authenticated;

comment on policy canteens_staff_update on public.canteens is
  'Row scope only. Which columns staff may actually write is set by the column grant in
   the canteen_column_grants migration: opens_at, closes_at, is_accepting_orders.';

-- ---------------------------------------------------------------------------
-- the admin's own write path
-- ---------------------------------------------------------------------------
-- The edit form submits every field it owns on each save, so these are plain
-- assignments rather than a coalesce-style patch: passing null to `phone` clears it,
-- which a "null means leave unchanged" signature could not express.
create or replace function public.admin_update_canteen(
  p_canteen_id          uuid,
  p_name                text,
  p_description         text,
  p_phone               text,
  p_image_url           text,
  p_min_order_paise     integer,
  p_opens_at            time,
  p_closes_at           time,
  p_is_accepting_orders boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'NOT_FOUND: a canteen needs a name' using errcode = 'P0001';
  end if;

  update public.canteens
     set name                = trim(p_name),
         description         = coalesce(p_description, ''),
         phone               = p_phone,
         image_url           = p_image_url,
         min_order_paise     = p_min_order_paise,
         opens_at            = p_opens_at,
         closes_at           = p_closes_at,
         is_accepting_orders = p_is_accepting_orders
   where id = p_canteen_id;

  if not found then
    raise exception 'NOT_FOUND: canteen %', p_canteen_id using errcode = 'P0001';
  end if;
end;
$$;

-- Separate from the edit form because the list's disable switch does not have the other
-- fields in hand, and making it send them back would be a race with anyone else editing.
--
-- Disabling is not deleting: `canteens_public` drops the row so students stop seeing it,
-- while orders, menu items and staff rows stay exactly where they are (context.md §5).
create or replace function public.admin_set_canteen_active(
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

  update public.canteens set is_active = p_active where id = p_canteen_id;

  if not found then
    raise exception 'NOT_FOUND: canteen %', p_canteen_id using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_update_canteen(uuid, text, text, text, text, integer,
                                                   time, time, boolean) from public;
revoke all on function public.admin_set_canteen_active(uuid, boolean) from public;
grant execute on function public.admin_update_canteen(uuid, text, text, text, text, integer,
                                                      time, time, boolean) to authenticated;
grant execute on function public.admin_set_canteen_active(uuid, boolean) to authenticated;
