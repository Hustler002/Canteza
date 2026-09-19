-- Order lifecycle functions.
--
-- These are the only way an order is ever created or moved. Clients hold no
-- INSERT/UPDATE grant on public.orders, so bypassing them is not possible.
--
-- Errors are raised as 'CODE: detail'. toAppError() in packages/shared/src/errors.ts
-- parses the prefix back into a typed AppError with a safe user-facing message, so
-- adding a code here means adding it there too.

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
-- Rows carry (audience, status) only. The text is rendered client-side by
-- packages/shared/src/notifications.ts so in-app and push wording cannot drift.

create or replace function public.notify_order(
  p_order_id  uuid,
  p_status    text,
  p_audiences text[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;

  if 'student' = any (p_audiences) then
    insert into public.notifications (user_id, audience, order_id, status)
    values (v_order.student_id, 'student', p_order_id, p_status);
  end if;

  if 'canteen' = any (p_audiences) then
    insert into public.notifications (user_id, audience, order_id, status)
    select cs.profile_id, 'canteen', p_order_id, p_status
      from public.canteen_staff cs
     where cs.canteen_id = v_order.canteen_id;
  end if;

  -- The open pool is discovered by querying public.delivery_pool, so partners are
  -- only notified about an order they already hold.
  if 'delivery' = any (p_audiences) and v_order.delivery_partner_id is not null then
    insert into public.notifications (user_id, audience, order_id, status)
    values (v_order.delivery_partner_id, 'delivery', p_order_id, p_status);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order
-- ---------------------------------------------------------------------------
-- Everything that could be raced happens inside this one transaction: the canteen
-- is re-checked, item rows are locked, prices are re-read from the database, and
-- the totals are computed server-side. The client's prices are never consulted.

create or replace function public.place_order(
  p_canteen_id      uuid,
  p_items           jsonb,     -- [{ "item_id": uuid, "quantity": int }, ...]
  p_hostel_id       uuid,
  p_block           text,
  p_room            text,
  p_idempotency_key text,
  p_note            text default '',
  p_coupon_code     text default null,
  p_payment_method  text default 'cod'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student   uuid := (select auth.uid());
  v_profile   public.profiles;
  v_canteen   public.canteens;
  v_hostel    public.hostels;
  v_coupon    public.coupons;
  v_menu      public.menu_items;
  v_line      record;
  v_existing  uuid;
  v_order_id  uuid;
  v_subtotal  integer := 0;
  v_units     integer := 0;
  v_discount  integer := 0;
  v_delivery_fee  integer;
  v_packaging_fee integer;
  v_payout    integer;
  v_max_qty   integer;
  v_max_units integer;
  v_redeemed  integer;
begin
  if v_student is null then
    raise exception 'UNAUTHENTICATED: no session' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where id = v_student;
  if not found or not v_profile.is_active or v_profile.role <> 'student' then
    raise exception 'FORBIDDEN: only students place orders' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null or length(p_idempotency_key) = 0 then
    raise exception 'DUPLICATE_REQUEST: idempotency key required' using errcode = 'P0001';
  end if;

  -- A retry (or a double tap that already committed) resolves to the first order.
  select id into v_existing from public.orders
   where student_id = v_student and idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  -- Canteen must exist, be active, be within hours, and not be paused.
  select * into v_canteen from public.canteens where id = p_canteen_id and is_active;
  if not found then
    raise exception 'NOT_FOUND: canteen %', p_canteen_id using errcode = 'P0001';
  end if;
  if not v_canteen.is_accepting_orders
     or not public.is_within_hours(v_canteen.opens_at, v_canteen.closes_at, public.campus_now())
  then
    raise exception 'CANTEEN_CLOSED: %', v_canteen.name using errcode = 'P0001';
  end if;

  -- Delivery address.
  select * into v_hostel from public.hostels where id = p_hostel_id and is_active;
  if not found then
    raise exception 'NOT_FOUND: hostel %', p_hostel_id using errcode = 'P0001';
  end if;
  if p_block is null or p_room is null or length(trim(p_room)) = 0 then
    raise exception 'NOT_FOUND: block and room are required' using errcode = 'P0001';
  end if;
  if array_length(v_hostel.blocks, 1) is not null and not (p_block = any (v_hostel.blocks)) then
    raise exception 'NOT_FOUND: block % is not in %', p_block, v_hostel.name using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'CART_EMPTY: no items' using errcode = 'P0001';
  end if;

  v_max_qty   := public.setting_int('max_quantity_per_item', 20);
  v_max_units := public.setting_int('max_items_per_order', 50);

  -- Duplicate item_ids in the payload are merged rather than rejected.
  for v_line in
    select (e ->> 'item_id')::uuid as item_id,
           sum((e ->> 'quantity')::integer) as quantity
      from jsonb_array_elements(p_items) e
     group by 1
  loop
    if v_line.quantity is null or v_line.quantity < 1 or v_line.quantity > v_max_qty then
      raise exception 'INVALID_QUANTITY: % for item %', v_line.quantity, v_line.item_id
        using errcode = 'P0001';
    end if;

    -- FOR SHARE holds the row until commit, so an item cannot be switched to
    -- unavailable (or repriced) between this check and the insert below.
    select * into v_menu from public.menu_items where id = v_line.item_id for share;

    if not found or not v_menu.is_active or not v_menu.is_available then
      raise exception 'ITEM_UNAVAILABLE: %', v_line.item_id using errcode = 'P0001';
    end if;
    if v_menu.canteen_id <> p_canteen_id then
      raise exception 'CART_MIXED_CANTEENS: %', v_line.item_id using errcode = 'P0001';
    end if;

    v_subtotal := v_subtotal + v_menu.price_paise * v_line.quantity;
    v_units    := v_units + v_line.quantity;
  end loop;

  if v_units > v_max_units then
    raise exception 'INVALID_QUANTITY: % items exceeds the per-order limit', v_units
      using errcode = 'P0001';
  end if;
  if v_subtotal < v_canteen.min_order_paise then
    raise exception 'BELOW_MINIMUM_ORDER: % < %', v_subtotal, v_canteen.min_order_paise
      using errcode = 'P0001';
  end if;

  -- Coupon. Mirrors couponDiscount() in packages/shared/src/pricing.ts.
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select * into v_coupon from public.coupons
     where code = upper(trim(p_coupon_code)) and is_active
       and valid_from <= now() and (valid_until is null or valid_until > now())
     for update;

    if not found then
      raise exception 'COUPON_INVALID: %', p_coupon_code using errcode = 'P0001';
    end if;
    if v_subtotal < v_coupon.min_order_paise then
      raise exception 'COUPON_INVALID: below minimum' using errcode = 'P0001';
    end if;

    select count(*) into v_redeemed from public.coupon_redemptions where coupon_id = v_coupon.id;
    if v_coupon.max_redemptions is not null and v_redeemed >= v_coupon.max_redemptions then
      raise exception 'COUPON_INVALID: fully redeemed' using errcode = 'P0001';
    end if;

    select count(*) into v_redeemed from public.coupon_redemptions
     where coupon_id = v_coupon.id and student_id = v_student;
    if v_redeemed >= v_coupon.per_student_limit then
      raise exception 'COUPON_INVALID: already used' using errcode = 'P0001';
    end if;

    v_discount := case v_coupon.kind
      when 'flat' then v_coupon.amount_paise
      else least(round(v_subtotal * v_coupon.percent_off / 100.0)::integer,
                 v_coupon.max_discount_paise)
    end;
    -- Never discount past the subtotal: a coupon does not pay for delivery.
    v_discount := least(v_discount, v_subtotal);
  end if;

  if p_payment_method not in ('cod', 'razorpay') then
    raise exception 'PAYMENT_FAILED: unknown method %', p_payment_method using errcode = 'P0001';
  end if;

  v_delivery_fee  := public.setting_int('delivery_fee_paise', 1000);
  v_packaging_fee := public.setting_int('packaging_fee_paise', 0);
  v_payout        := public.setting_int('partner_payout_paise', 800);

  begin
    insert into public.orders (
      student_id, canteen_id, canteen_name_snapshot,
      hostel_id, hostel_label, block, room, delivery_note,
      subtotal_paise, discount_paise, delivery_fee_paise, packaging_fee_paise,
      total_paise, partner_payout_paise,
      coupon_id, coupon_code_snapshot, idempotency_key
    ) values (
      v_student, v_canteen.id, v_canteen.name,
      v_hostel.id, v_hostel.name, p_block, trim(p_room), coalesce(p_note, ''),
      v_subtotal, v_discount, v_delivery_fee, v_packaging_fee,
      v_subtotal - v_discount + v_delivery_fee + v_packaging_fee, v_payout,
      v_coupon.id, v_coupon.code, p_idempotency_key
    ) returning id into v_order_id;
  exception when unique_violation then
    -- Two identical requests raced past the lookup above; the other one won.
    select id into v_order_id from public.orders
     where student_id = v_student and idempotency_key = p_idempotency_key;
    return v_order_id;
  end;

  -- Prices are re-read from the rows locked FOR SHARE above, so these snapshots are
  -- exactly what was validated and charged.
  insert into public.order_items (
    order_id, menu_item_id, name_snapshot, is_veg, unit_price_paise, quantity, line_total_paise
  )
  select v_order_id, m.id, m.name, m.is_veg, m.price_paise, q.quantity,
         m.price_paise * q.quantity
    from (
      select (e ->> 'item_id')::uuid as item_id,
             sum((e ->> 'quantity')::integer) as quantity
        from jsonb_array_elements(p_items) e
       group by 1
    ) q
    join public.menu_items m on m.id = q.item_id;

  insert into public.payments (order_id, method, status, amount_paise)
  values (
    v_order_id,
    p_payment_method,
    case when p_payment_method = 'cod' then 'pending' else 'initiated' end,
    v_subtotal - v_discount + v_delivery_fee + v_packaging_fee
  );

  if v_coupon.id is not null then
    insert into public.coupon_redemptions (coupon_id, student_id, order_id, discount_paise)
    values (v_coupon.id, v_student, v_order_id, v_discount);
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor, actor_id)
  values (v_order_id, null, 'pending', 'student', v_student);

  perform public.notify_order(v_order_id, 'pending', array['student', 'canteen']);

  return v_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- transition_order
-- ---------------------------------------------------------------------------
-- The actor is derived from the caller's relationship to the order, never sent by
-- the client. The move itself is looked up in public.order_transitions, which
-- mirrors ORDER_TRANSITIONS in packages/shared/src/order-status.ts.

create or replace function public.transition_order(
  p_order_id uuid,
  p_to       text,
  p_reason   text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_order   public.orders;
  v_actor   text;
  v_from    text;
  v_updated integer;
  v_audiences text[] := array['student'];
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: no session' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND: order %', p_order_id using errcode = 'P0001';
  end if;
  v_from := v_order.status;

  if public.is_admin() then
    v_actor := 'admin';
  elsif v_order.canteen_id = public.my_canteen_id() then
    v_actor := 'canteen';
  elsif v_order.delivery_partner_id = v_uid then
    v_actor := 'delivery';
  elsif v_order.student_id = v_uid then
    v_actor := 'student';
  else
    raise exception 'FORBIDDEN: not a party to order %', p_order_id using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.order_transitions
     where from_status = v_from and to_status = p_to and actor = v_actor
  ) then
    raise exception 'INVALID_TRANSITION: % -> % as %', v_from, p_to, v_actor
      using errcode = 'P0001';
  end if;

  -- Conditional update: if anything moved the row since we read it, we lose.
  update public.orders
     set status = p_to,
         -- assigned -> ready is a partner abandoning the claim; back to the pool.
         delivery_partner_id = case when p_to = 'ready' then null else delivery_partner_id end,
         cancellation_reason = case when p_to in ('cancelled', 'rejected')
                                    then p_reason else cancellation_reason end
   where id = p_order_id and status = v_from;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'INVALID_TRANSITION: order % already moved on', p_order_id
      using errcode = 'P0001';
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor, actor_id, reason)
  values (p_order_id, v_from, p_to, v_actor, v_uid, p_reason);

  -- Cash is collected at the door, so delivery settles a COD payment.
  if p_to = 'delivered' then
    update public.payments
       set status = 'success', paid_at = now()
     where order_id = p_order_id and method = 'cod' and status = 'pending';
  end if;

  -- An order that never happened was never paid for.
  if p_to in ('cancelled', 'rejected') then
    update public.payments
       set status = 'failed', failure_reason = coalesce(p_reason, p_to)
     where order_id = p_order_id and status in ('initiated', 'pending');
    v_audiences := array['student', 'canteen', 'delivery'];
  end if;

  perform public.notify_order(p_order_id, p_to, v_audiences);
  return p_to;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_delivery
-- ---------------------------------------------------------------------------
-- Two partners tapping "Accept" at the same instant: the WHERE clause decides.
-- The loser gets DELIVERY_ALREADY_CLAIMED, not a silent overwrite.

create or replace function public.claim_delivery(p_order_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: no session' using errcode = 'P0001';
  end if;
  if not public.is_delivery_partner() then
    raise exception 'FORBIDDEN: not an approved delivery partner' using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'assigned', delivery_partner_id = v_uid
   where id = p_order_id
     and status = 'ready'
     and delivery_partner_id is null;

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

-- Releasing a claim is just the assigned -> ready edge; named for the delivery app.
create or replace function public.release_delivery(p_order_id uuid) returns text
language sql
as $$
  select public.transition_order(p_order_id, 'ready', 'released by partner');
$$;

-- ---------------------------------------------------------------------------
-- execution grants
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default; revoke before granting.

revoke all on function public.notify_order(uuid, text, text[]) from public;
revoke all on function public.place_order(uuid, jsonb, uuid, text, text, text, text, text, text) from public;
revoke all on function public.transition_order(uuid, text, text) from public;
revoke all on function public.claim_delivery(uuid) from public;
revoke all on function public.release_delivery(uuid) from public;

grant execute on function public.place_order(uuid, jsonb, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.transition_order(uuid, text, text) to authenticated;
grant execute on function public.claim_delivery(uuid) to authenticated;
grant execute on function public.release_delivery(uuid) to authenticated;
