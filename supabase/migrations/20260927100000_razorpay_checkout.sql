-- Razorpay, the checkout half.
--
-- `20260926150000_razorpay_payments.sql` built the recorder and the webhook's side of
-- the seam. Wiring a real checkout to it exposed four things that migration could not
-- see from where it stood, and each one is a way money and orders fall out of step:
--
--   1. **A retry inside the sheet was dropped.** Razorpay's checkout lets a student try
--      a second card on the *same* Razorpay order after the first is declined. The first
--      attempt's `payment.failed` moves our row to `failed`, and `failed -> success` is
--      not a move the state machine defines -- so the second attempt's
--      `payment.captured` came back STALE_EVENT. The money was taken and the order was
--      never released to the kitchen.
--   2. **A cancelled order could be paid for.** `begin_razorpay_payment` checked the
--      payment and never the order, so an order the student had already cancelled (or
--      the sweep had expired) could be handed a fresh Razorpay order.
--   3. **Two taps could attach two Razorpay orders.** The second `begin` overwrote the
--      first, so paying on the first sheet produced a webhook for an id we no longer
--      held -- UNKNOWN_ORDER, retried by Razorpay until it gave up. First writer now
--      wins, and every caller is told which id is in effect.
--   4. **The kitchen heard about orders nobody had paid for.** `place_order` notified
--      the canteen at placement, which for a prepaid order is before a rupee has moved.
--
-- Plus one that is not a bug but a gap: money captured for an order that is already
-- cancelled had nowhere to go. It is now recorded and reported as REFUND_REQUIRED
-- rather than dismissed as a stale event.

-- ---------------------------------------------------------------------------
-- the kitchen hears about a prepaid order when it is paid for
-- ---------------------------------------------------------------------------
-- Only the canteen audience of a `pending` notification changes. A prepaid order that
-- is still short of `success` cannot be accepted (`transition_order` refuses with
-- PAYMENT_UNVERIFIED), so telling the counter about it asks them to look at something
-- they can do nothing with -- and every abandoned checkout would page them for nothing.
-- `record_payment_result` sends that same notification the moment the money lands.

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
  v_awaiting_payment boolean;
begin
  select * into v_order from public.orders where id = p_order_id;

  if 'student' = any (p_audiences) then
    insert into public.notifications (user_id, audience, order_id, status)
    values (v_order.student_id, 'student', p_order_id, p_status);
  end if;

  v_awaiting_payment := p_status = 'pending' and exists (
    select 1 from public.payments pay
     where pay.order_id = p_order_id and pay.method <> 'cod' and pay.status <> 'success'
  );

  if 'canteen' = any (p_audiences) and not v_awaiting_payment then
    insert into public.notifications (user_id, audience, order_id, status)
    select cs.profile_id, 'canteen', p_order_id, p_status
      from public.canteen_staff cs
     where cs.canteen_id = v_order.canteen_id;
  end if;

  -- A canteen's ready queue is visible to its own partners through the orders policy,
  -- so partners are only notified about an order they already hold.
  if 'delivery' = any (p_audiences) and v_order.delivery_partner_id is not null then
    insert into public.notifications (user_id, audience, order_id, status)
    values (v_order.delivery_partner_id, 'delivery', p_order_id, p_status);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- begin_razorpay_payment: first writer wins, and only while the order is open
-- ---------------------------------------------------------------------------
-- Returns the Razorpay order id actually in effect, which is not always the one passed
-- in. The Edge Function creates a Razorpay order and then calls this; if two calls race,
-- both create one, the first attaches, and the second is handed the first's id to open
-- the sheet with. The loser's Razorpay order is never paid and costs nothing.
--
-- It also makes a retry after a declined card reuse the same Razorpay order, which is
-- how Razorpay intends orders to be used: one accepts further attempts until a payment
-- is captured and refuses any after that, so there is no second bill to pay by accident.
--
-- The return type changes from void, which `create or replace` cannot do.

drop function if exists public.begin_razorpay_payment(uuid, text);

create function public.begin_razorpay_payment(
  p_order_id          uuid,
  p_provider_order_id text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_payment public.payments;
  v_effective text;
begin
  if coalesce(trim(p_provider_order_id), '') = '' then
    raise exception 'PAYMENT_FAILED: a provider order id is required' using errcode = 'P0001';
  end if;

  -- Lock the order first, so a cancellation cannot land between this check and the
  -- write below.
  select status into v_order_status from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND: order %', p_order_id using errcode = 'P0001';
  end if;
  if v_order_status <> 'pending' then
    raise exception 'INVALID_TRANSITION: order % is % and takes no payment',
      p_order_id, v_order_status using errcode = 'P0001';
  end if;

  select * into v_payment from public.payments where order_id = p_order_id for update;

  -- Only a payment still waiting to be paid. A succeeded one must never be re-pointed,
  -- or a second charge could be attached to a settled bill.
  if not found or v_payment.method = 'cod' or v_payment.status not in ('initiated', 'failed') then
    raise exception 'PAYMENT_FAILED: order % has no payment awaiting checkout', p_order_id
      using errcode = 'P0001';
  end if;

  -- A retry after a declined card starts the cycle again, which the state machine allows
  -- precisely so a student can try a second card.
  update public.payments
     set provider_order_id = coalesce(provider_order_id, p_provider_order_id),
         status            = 'initiated',
         failure_reason    = null
   where id = v_payment.id
  returning provider_order_id into v_effective;

  return v_effective;
end;
$$;

revoke all on function public.begin_razorpay_payment(uuid, text) from public;
grant execute on function public.begin_razorpay_payment(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- record_payment_result: retries, late captures, and telling everyone
-- ---------------------------------------------------------------------------

create or replace function public.record_payment_result(
  p_provider_order_id   text,
  p_provider_payment_id text,
  p_status              text,
  p_amount_paise        integer,
  p_failure_reason      text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_existing public.payments;
  v_order_status text;
begin
  if p_status not in ('success', 'failed') then
    raise exception 'PAYMENT_FAILED: unsupported result %', p_status using errcode = 'P0001';
  end if;
  if coalesce(trim(p_provider_payment_id), '') = '' then
    raise exception 'PAYMENT_FAILED: a provider payment id is required' using errcode = 'P0001';
  end if;

  -- Idempotency, first and on the column the database already makes unique. Razorpay
  -- retries a webhook until it sees a 2xx and can deliver the same event twice even
  -- after one, so "seen this payment id" is the question to ask before anything else.
  select * into v_existing
    from public.payments
   where provider_payment_id = p_provider_payment_id;

  if found then
    if v_existing.status = p_status then
      return 'ALREADY_RECORDED';
    end if;
    v_payment := v_existing;
  else
    select * into v_payment
      from public.payments
     where provider_order_id = p_provider_order_id;

    if not found then
      return 'UNKNOWN_ORDER';
    end if;
  end if;

  -- A signature proves the message came from Razorpay. It does not prove the amount
  -- matches what we charged -- a mis-integration that creates a ₹1 Razorpay order for a
  -- ₹340 basket would be correctly signed and completely wrong.
  if p_amount_paise is distinct from v_payment.amount_paise then
    raise exception 'PAYMENT_FAILED: amount % does not match the order''s %',
      p_amount_paise, v_payment.amount_paise using errcode = 'P0001';
  end if;

  select status into v_order_status from public.orders where id = v_payment.order_id for update;

  if p_status = 'success' and v_payment.status = 'failed' then
    if v_order_status = 'pending' then
      -- A second attempt on the same Razorpay order after the first was declined.
      -- `failed -> initiated -> success` is two moves the state machine does define,
      -- taken back to back; it is not a shortcut around it.
      v_payment.status := 'initiated';
    else
      -- Money captured for an order that is no longer work: the student paid in the
      -- same moment they cancelled, or after the sweep expired the order. There is no
      -- legal status to move to, and dismissing it as stale would lose track of a real
      -- charge. Keep the payment id against the row so it can be found and refunded,
      -- and say so to the caller, which logs it loudly.
      update public.payments
         set provider_payment_id = p_provider_payment_id,
             failure_reason = format('captured after the order was %s; refund required',
                                     v_order_status)
       where id = v_payment.id;
      return 'REFUND_REQUIRED';
    end if;
  end if;

  if not exists (
    select 1 from public.payment_transitions
     where from_status = v_payment.status and to_status = p_status
  ) then
    -- Out-of-order webhooks are normal: a `payment.failed` for the first attempt can
    -- land after the `payment.captured` of the second. Refusing quietly is right, and the
    -- caller answers 200 so Razorpay stops retrying something deliberately ignored.
    return 'STALE_EVENT';
  end if;

  update public.payments
     set status              = p_status,
         provider_payment_id = p_provider_payment_id,
         paid_at             = case when p_status = 'success' then now() else paid_at end,
         failure_reason      = case when p_status = 'failed' then p_failure_reason else null end
   where id = v_payment.id;

  -- Touch the order. `payments` is not in the realtime publication and does not need to
  -- be: every screen already watches its orders, so bumping `updated_at` is what makes
  -- the student's tracker and the counter's board refetch the moment the money lands --
  -- no second channel, no polling.
  update public.orders set updated_at = now() where id = v_payment.order_id;

  if p_status = 'success' and v_order_status = 'pending' then
    -- The notification `notify_order` held back at placement.
    perform public.notify_order(v_payment.order_id, 'pending', array['canteen']);
  end if;

  return case when p_status = 'success' then 'PAID' else 'FAILED' end;
end;
$$;

revoke all on function public.record_payment_result(text, text, text, integer, text) from public;
grant execute on function public.record_payment_result(text, text, text, integer, text) to service_role;

comment on function public.record_payment_result(text, text, text, integer, text) is
  'The only path to a successful Razorpay payment. Idempotent on provider_payment_id,
   re-checks the amount, accepts a retry on the same Razorpay order after a decline, and
   reports REFUND_REQUIRED for money captured against an order that is no longer open.';
