-- A prepaid order is "placed" when it is paid for, for the student as well as the counter.
--
-- `20260927100000_razorpay_checkout.sql` stopped paging the counter for an order nobody had
-- paid for, and left the student's own "Order placed" firing at `place_order`. Found on the
-- device (2026-09-28): the student tapped "Pay ₹100", the notification arrived while the
-- Razorpay sheet was still open, and it claimed an order was placed that might never be.
-- For a prepaid order nothing is placed until the webhook says the money arrived.
--
-- So `notify_order` withholds a `pending` notification from both audiences while the
-- payment is short of `success`, and `record_payment_result` sends both the moment it
-- lands. Cash is untouched: a cash order is real the moment it exists, and both hear
-- about it then. An abandoned prepaid order still tells the student it was cancelled --
-- they tapped Pay, and should learn the order is gone.
--
-- Only the lines that change differ from the previous definitions; both functions are
-- restated whole because `create or replace` has no other way to change one.

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

  v_awaiting_payment := p_status = 'pending' and exists (
    select 1 from public.payments pay
     where pay.order_id = p_order_id and pay.method <> 'cod' and pay.status <> 'success'
  );

  if 'student' = any (p_audiences) and not v_awaiting_payment then
    insert into public.notifications (user_id, audience, order_id, status)
    values (v_order.student_id, 'student', p_order_id, p_status);
  end if;

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
    -- The notifications `notify_order` held back at placement: the student's "Order
    -- placed" and the counter's "New order", together, now that both are true.
    perform public.notify_order(v_payment.order_id, 'pending', array['student', 'canteen']);
  end if;

  return case when p_status = 'success' then 'PAID' else 'FAILED' end;
end;
$$;

revoke all on function public.record_payment_result(text, text, text, integer, text) from public;
grant execute on function public.record_payment_result(text, text, text, integer, text) to service_role;
