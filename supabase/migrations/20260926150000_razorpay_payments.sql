-- Razorpay, server side.
--
-- ADR 006 built the seam and left the far side of it empty: `payments` rows are created
-- by `place_order`, `transition_order` refuses `pending -> accepted` while a non-COD
-- payment is short of `success`, and **nothing could ever write that success**. The
-- table's only client grant is SELECT, which is correct, and no function existed to
-- move a Razorpay payment at all. This is that function, plus the two gaps the ADR
-- listed as outstanding: an abandoned-payment timeout, and a place to attach the
-- provider's order id.
--
-- Nothing here trusts a caller. `record_payment_result` is reached only by the
-- `verify-payment` Edge Function, which has already recomputed Razorpay's HMAC over the
-- raw request body — but this still re-checks the amount and the state machine, because
-- a signature proves who sent a message and not that the message is sane.

-- ---------------------------------------------------------------------------
-- the payment state machine, in SQL
-- ---------------------------------------------------------------------------
-- Mirrors PAYMENT_TRANSITIONS in packages/shared/src/payment.ts. The TypeScript copy
-- exists for pre-submit UX; this one is authoritative, exactly as with order status.
-- A test compares the two, so drift fails CI rather than production.

create table if not exists public.payment_transitions (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
);

insert into public.payment_transitions (from_status, to_status) values
  ('initiated', 'pending'),
  ('initiated', 'success'),
  ('initiated', 'failed'),
  ('pending',   'success'),
  ('pending',   'failed'),
  ('success',   'refunded'),
  ('failed',    'initiated')
on conflict do nothing;

alter table public.payment_transitions enable row level security;

-- Reference data, the same shape `order_transitions` has: readable by anyone signed in,
-- writable by nobody through the API.
create policy payment_transitions_read on public.payment_transitions
  for select to authenticated using (true);

grant select on public.payment_transitions to authenticated;

-- ---------------------------------------------------------------------------
-- begin_razorpay_payment
-- ---------------------------------------------------------------------------
-- Records the Razorpay order id against our payment row once the Edge Function has
-- created one. Separate from `record_payment_result` because it happens before the
-- student has paid anything, and because the webhook finds our row *by* this id.

create or replace function public.begin_razorpay_payment(
  p_order_id          uuid,
  p_provider_order_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if coalesce(trim(p_provider_order_id), '') = '' then
    raise exception 'PAYMENT_FAILED: a provider order id is required' using errcode = 'P0001';
  end if;

  -- Only a payment still waiting to be paid. A succeeded one must never be re-pointed
  -- at a new Razorpay order, or a second charge could be attached to a settled bill.
  update public.payments
     set provider_order_id = p_provider_order_id
   where order_id = p_order_id
     and method <> 'cod'
     and status in ('initiated', 'failed');

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'PAYMENT_FAILED: order % has no payment awaiting checkout', p_order_id
      using errcode = 'P0001';
  end if;

  -- A retry after a failed attempt starts the cycle again, which the state machine
  -- allows precisely so a student can try a second card.
  update public.payments
     set status = 'initiated', failure_reason = null
   where order_id = p_order_id and status = 'failed';
end;
$$;

-- ---------------------------------------------------------------------------
-- record_payment_result
-- ---------------------------------------------------------------------------
-- The only path by which a Razorpay payment ever reaches `success`.
--
-- Returns a short code rather than raising for the outcomes a webhook legitimately
-- produces, because the caller has to decide an HTTP status from it and Razorpay retries
-- on anything that is not 2xx. "I already have this" must answer 200, or the retry storm
-- never stops; "I do not know this order" must not, because it may simply be a webhook
-- arriving before our own transaction committed.

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
    -- Same payment id, different outcome: a captured payment later refunded arrives
    -- this way. Fall through to the state-machine check rather than guessing.
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

  if not exists (
    select 1 from public.payment_transitions
     where from_status = v_payment.status and to_status = p_status
  ) then
    -- Out-of-order webhooks are normal: a `payment.failed` can land after the
    -- `payment.captured` that superseded it. Refusing quietly is right, and the caller
    -- answers 200 so Razorpay stops retrying something we have deliberately ignored.
    return 'STALE_EVENT';
  end if;

  update public.payments
     set status              = p_status,
         provider_payment_id = p_provider_payment_id,
         paid_at             = case when p_status = 'success' then now() else paid_at end,
         failure_reason      = case when p_status = 'failed' then p_failure_reason else null end
   where id = v_payment.id;

  return case when p_status = 'success' then 'PAID' else 'FAILED' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- expire_unpaid_orders
-- ---------------------------------------------------------------------------
-- The gap ADR 006 wrote down and left open: "a timeout that cancels orders left unpaid;
-- it needs a scheduled job and lands with Razorpay in Phase 8".
--
-- A student who opens checkout and closes the app leaves an order at `pending` with an
-- unpaid Razorpay payment. `transition_order` refuses to let a canteen accept it, so it
-- is not dangerous -- it is litter, and it sits on the counter's New tab forever.
--
-- It does not call `transition_order`, because that resolves an actor from auth.uid()
-- and there is no one signed in here. It writes the same history row with actor
-- 'system', which the check constraint has always allowed for exactly this.

create or replace function public.expire_unpaid_orders(
  p_older_than interval default interval '15 minutes'
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select o.id
      from public.orders o
      join public.payments pay on pay.order_id = o.id
     where o.status = 'pending'
       and pay.method <> 'cod'
       and pay.status in ('initiated', 'pending')
       and o.created_at < now() - p_older_than
  loop
    update public.orders
       set status = 'cancelled',
           cancellation_reason = 'payment not completed'
     where id = v_order.id and status = 'pending';

    if found then
      insert into public.order_status_history
        (order_id, from_status, to_status, actor, actor_id, reason)
      values (v_order.id, 'pending', 'cancelled', 'system', null, 'payment not completed');

      update public.payments
         set status = 'failed', failure_reason = 'abandoned at checkout'
       where order_id = v_order.id and status in ('initiated', 'pending');

      -- Rule 12: a cancelled order consumes nothing, so the coupon goes back.
      delete from public.coupon_redemptions where order_id = v_order.id;

      perform public.notify_order(v_order.id, 'cancelled', array['student']);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- execution grants
-- ---------------------------------------------------------------------------
-- None of these are for a client. `begin_razorpay_payment` and `record_payment_result`
-- are called by the Edge Function with the service role key, which is the whole point of
-- ADR 006's seam: the app asks for a payment and learns the outcome by refetching, and
-- never asserts one.

revoke all on function public.begin_razorpay_payment(uuid, text) from public;
revoke all on function public.record_payment_result(text, text, text, integer, text) from public;
revoke all on function public.expire_unpaid_orders(interval) from public;

grant execute on function public.begin_razorpay_payment(uuid, text) to service_role;
grant execute on function public.record_payment_result(text, text, text, integer, text) to service_role;
grant execute on function public.expire_unpaid_orders(interval) to service_role;

comment on function public.record_payment_result(text, text, text, integer, text) is
  'The only path to a successful Razorpay payment. Idempotent on provider_payment_id,
   re-checks the amount against what was charged, and refuses a move the payment state
   machine does not allow. Returns a code so the webhook can answer 200 to a duplicate.';
