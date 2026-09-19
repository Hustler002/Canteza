-- `is_online` becomes a real shift toggle.
--
-- It existed from Phase 2 but gated nothing: an off-shift partner still saw their
-- canteen's ready queue and could still claim from it. A control that visibly does
-- nothing is worse than no control, so it now decides queue visibility and claiming.
--
-- What deliberately does NOT depend on it: an order already in the partner's hands.
-- The `orders` policy matches those by `delivery_partner_id = auth.uid()`, and
-- `transition_order` resolves the actor the same way, so going off shift never
-- strands food someone is already carrying.

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
     and dp.is_approved and dp.is_active and dp.is_online and p.is_active;
$$;

comment on column public.delivery_partners.is_online is
  'The partner''s own shift toggle. False hides the canteen''s ready queue and refuses
   new claims; orders already held remain visible and completable.';

-- Tells "you are off shift" apart from "you are not a delivery partner here", which
-- are the same null from my_delivery_canteen_id() but very different to be told.
create or replace function public.claim_delivery(p_order_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_canteen uuid := public.my_delivery_canteen_id();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: no session' using errcode = 'P0001';
  end if;

  if v_canteen is null then
    -- An approved, active posting that is merely off shift gets a different message.
    if exists (
      select 1 from public.delivery_partners dp
       where dp.profile_id = v_uid and dp.is_approved and dp.is_active and not dp.is_online
    ) then
      raise exception 'OFF_SHIFT: go online to take deliveries' using errcode = 'P0001';
    end if;
    raise exception 'FORBIDDEN: not an active delivery partner' using errcode = 'P0001';
  end if;

  -- Distinguish "someone beat me to it" from "that is not my canteen's order", so the
  -- app can say something true. The composite foreign key on orders would refuse a
  -- cross-canteen pairing anyway; this exists to make the failure legible.
  if exists (
    select 1 from public.orders o
     where o.id = p_order_id and o.canteen_id <> v_canteen
  ) then
    raise exception 'FORBIDDEN: order belongs to another canteen' using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'assigned', delivery_partner_id = v_uid
   where id = p_order_id
     and status = 'ready'
     and delivery_partner_id is null
     and canteen_id = v_canteen;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'DELIVERY_ALREADY_CLAIMED: order %', p_order_id using errcode = 'P0001';
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor, actor_id)
  values (p_order_id, 'ready', 'assigned', 'delivery', v_uid);

  perform public.notify_order(p_order_id, 'assigned', array['student']);
  return p_order_id;
end;
$$;

-- An index for the partner's own history screen: their completed deliveries, newest
-- first. orders_by_partner covers the lookup but not the status filter.
create index orders_partner_completed on public.orders (delivery_partner_id, created_at desc)
  where status = 'delivered';
