import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, menuItem, placeOrder, seedCampus, type Campus, type Db } from './harness';

/**
 * The Razorpay server side: `begin_razorpay_payment`, `record_payment_result` and
 * `expire_unpaid_orders`.
 *
 * ADR 006 built the seam and left the far side empty — `transition_order` refused
 * `pending -> accepted` for an unpaid prepaid order, and nothing in the schema could
 * ever write the `success` that would release it. These are the functions that close
 * it, so the things worth pinning are the ones that protect money:
 *
 *   - a payment reaches `success` only through the recorder, never a client;
 *   - the same webhook delivered twice changes nothing the second time;
 *   - a correctly-signed webhook for the wrong amount is still refused;
 *   - an event that arrives out of order does not undo a later one;
 *   - an order abandoned at checkout is cancelled and gives its coupon back.
 */

let db: Db;
let campus: Campus;
let maggi: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
  campus = await seedCampus(db);
  maggi = await menuItem(db, campus.mainCanteen, 'Masala Maggi');
});
afterAll(async () => {
  await db?.close();
});

/** A prepaid order, sitting unpaid at `pending`, with a Razorpay order id attached. */
async function prepaidOrder(providerOrderId: string): Promise<string> {
  await db.asUser(campus.student);
  const id = await placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    // Two: Main Canteen's seeded minimum is ₹50 and a Maggi is ₹40.
    items: [{ item_id: maggi, quantity: 2 }],
    key: `rzp-${counter++}`,
    method: 'razorpay',
  });

  await db.asOwner();
  await db.query(`select public.begin_razorpay_payment($1::uuid, $2)`, [id, providerOrderId]);
  return id;
}

async function paymentFor(orderId: string) {
  const { rows } = await db.query<{
    status: string;
    amount_paise: number;
    provider_payment_id: string | null;
    failure_reason: string | null;
    paid_at: Date | null;
  }>(`select * from public.payments where order_id = $1::uuid`, [orderId]);
  return rows[0];
}

async function record(
  providerOrderId: string,
  providerPaymentId: string,
  status: string,
  amountPaise: number,
  reason: string | null = null,
): Promise<string> {
  await db.asOwner();
  const { rows } = await db.query<{ result: string }>(
    `select public.record_payment_result($1, $2, $3, $4, $5) as result`,
    [providerOrderId, providerPaymentId, status, String(amountPaise), reason],
  );
  return rows[0]!.result;
}

async function orderStatus(orderId: string): Promise<string> {
  await db.asOwner();
  const { rows } = await db.query<{ status: string }>(
    `select status from public.orders where id = $1::uuid`,
    [orderId],
  );
  return rows[0]!.status;
}

describe('a prepaid order before payment', () => {
  it('starts initiated, not pending — cash is pending, a card is not yet anything', async () => {
    const orderId = await prepaidOrder('order_state_1');
    const payment = await paymentFor(orderId);
    expect(payment?.status).toBe('initiated');
    expect(payment?.amount_paise).toBeGreaterThan(0);
  });

  it('cannot be accepted by the canteen, which is the whole point of the seam', async () => {
    const orderId = await prepaidOrder('order_state_2');
    await db.asUser(campus.staff);
    await expect(
      db.query(`select public.transition_order($1::uuid, 'accepted', null)`, [orderId]),
    ).rejects.toThrow(/PAYMENT_UNVERIFIED/);
  });

  it('cannot be marked paid by the student, who has no write on payments at all', async () => {
    const orderId = await prepaidOrder('order_state_3');
    await db.asUser(campus.student);
    await expect(
      db.query(`update public.payments set status = 'success' where order_id = $1::uuid`, [
        orderId,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('recording a result', () => {
  it('releases the order for the canteen once the payment succeeds', async () => {
    const orderId = await prepaidOrder('order_pay_1');
    const amount = (await paymentFor(orderId))!.amount_paise;

    expect(await record('order_pay_1', 'pay_1', 'success', amount)).toBe('PAID');

    const payment = await paymentFor(orderId);
    expect(payment?.status).toBe('success');
    expect(payment?.provider_payment_id).toBe('pay_1');
    expect(payment?.paid_at).not.toBeNull();

    // And the gate opens.
    await db.asUser(campus.staff);
    await db.query(`select public.transition_order($1::uuid, 'accepted', null)`, [orderId]);
    expect(await orderStatus(orderId)).toBe('accepted');
  });

  it('is idempotent: the same webhook twice changes nothing the second time', async () => {
    const orderId = await prepaidOrder('order_pay_2');
    const amount = (await paymentFor(orderId))!.amount_paise;

    expect(await record('order_pay_2', 'pay_2', 'success', amount)).toBe('PAID');
    const first = await paymentFor(orderId);

    // Razorpay retries until it sees a 2xx, and can deliver a duplicate even after one.
    expect(await record('order_pay_2', 'pay_2', 'success', amount)).toBe('ALREADY_RECORDED');
    const second = await paymentFor(orderId);

    // `toEqual`, not `toBe`: PGlite hands back a timestamptz as a Date, so two reads
    // of the same unchanged column are equal in value and distinct as objects.
    expect(second?.paid_at).toEqual(first?.paid_at);
    expect(second?.status).toBe('success');
  });

  it('refuses a correctly-addressed webhook carrying the wrong amount', async () => {
    const orderId = await prepaidOrder('order_pay_3');
    const amount = (await paymentFor(orderId))!.amount_paise;

    // A signature proves the sender, not the sense. A ₹1 Razorpay order created for a
    // ₹80 basket would be perfectly signed and completely wrong.
    await expect(record('order_pay_3', 'pay_3', 'success', amount - 100)).rejects.toThrow(
      /PAYMENT_FAILED: amount/,
    );
    expect((await paymentFor(orderId))?.status).toBe('initiated');
  });

  it('records a failure with its reason and leaves the order unaccepted', async () => {
    const orderId = await prepaidOrder('order_pay_4');
    const amount = (await paymentFor(orderId))!.amount_paise;

    expect(await record('order_pay_4', 'pay_4', 'failed', amount, 'Card declined')).toBe('FAILED');

    const payment = await paymentFor(orderId);
    expect(payment?.status).toBe('failed');
    expect(payment?.failure_reason).toBe('Card declined');
    expect(await orderStatus(orderId)).toBe('pending');
  });

  it('ignores a stale event rather than undoing a later one', async () => {
    const orderId = await prepaidOrder('order_pay_5');
    const amount = (await paymentFor(orderId))!.amount_paise;

    await record('order_pay_5', 'pay_5', 'success', amount);
    // A `payment.failed` for a different attempt on the same order, arriving late.
    // success -> failed is not in the transition table, so it must be refused without
    // an error — the webhook has to answer 200 or Razorpay retries it forever.
    expect(await record('order_pay_5', 'pay_5_other', 'failed', amount)).toBe('STALE_EVENT');
    expect((await paymentFor(orderId))?.status).toBe('success');
  });

  it('reports an unknown order instead of raising, so a race can be retried', async () => {
    // A webhook can outrun our own commit. That is not an error, and answering
    // non-2xx is what makes Razorpay try again a moment later.
    expect(await record('order_never_created', 'pay_x', 'success', 8000)).toBe('UNKNOWN_ORDER');
  });

  it('refuses a result the payment state machine does not define', async () => {
    const orderId = await prepaidOrder('order_pay_6');
    const amount = (await paymentFor(orderId))!.amount_paise;
    await expect(record('order_pay_6', 'pay_6', 'refunded', amount)).rejects.toThrow(
      /unsupported result/,
    );
  });
});

describe('retrying after a failure', () => {
  it('reuses the same Razorpay order, which accepts attempts until one is captured', async () => {
    const orderId = await prepaidOrder('order_retry_1');
    const amount = (await paymentFor(orderId))!.amount_paise;
    await record('order_retry_1', 'pay_r1', 'failed', amount, 'Card declined');

    // The Edge Function passes whatever id it has; the one already attached wins.
    await db.asOwner();
    const { rows } = await db.query<{ effective: string }>(
      `select public.begin_razorpay_payment($1::uuid, $2) as effective`,
      [orderId, 'order_retry_1b'],
    );
    expect(rows[0]!.effective).toBe('order_retry_1');

    const payment = await paymentFor(orderId);
    expect(payment?.status).toBe('initiated');
    expect(payment?.failure_reason).toBeNull();

    expect(await record('order_retry_1', 'pay_r2', 'success', amount)).toBe('PAID');
    expect((await paymentFor(orderId))?.status).toBe('success');
  });

  it('accepts a second card tried inside the same sheet, with no begin in between', async () => {
    // The bug the checkout migration exists for. Razorpay's sheet offers a retry after
    // a decline without closing, so the capture of attempt two arrives while our row
    // still says `failed` from attempt one. It used to come back STALE_EVENT: money
    // taken, order never released to the kitchen.
    const orderId = await prepaidOrder('order_retry_sheet');
    const amount = (await paymentFor(orderId))!.amount_paise;

    expect(await record('order_retry_sheet', 'pay_s1', 'failed', amount, 'Card declined')).toBe(
      'FAILED',
    );
    expect(await record('order_retry_sheet', 'pay_s2', 'success', amount)).toBe('PAID');

    const payment = await paymentFor(orderId);
    expect(payment?.status).toBe('success');
    expect(payment?.provider_payment_id).toBe('pay_s2');
    expect(payment?.failure_reason).toBeNull();

    // And attempt one's failure, redelivered late, does not undo it.
    expect(await record('order_retry_sheet', 'pay_s1', 'failed', amount, 'Card declined')).toBe(
      'STALE_EVENT',
    );
    expect((await paymentFor(orderId))?.status).toBe('success');
  });

  it('never re-points a settled payment at a new Razorpay order', async () => {
    const orderId = await prepaidOrder('order_retry_2');
    const amount = (await paymentFor(orderId))!.amount_paise;
    await record('order_retry_2', 'pay_r3', 'success', amount);

    await db.asOwner();
    await expect(
      db.query(`select public.begin_razorpay_payment($1::uuid, $2)`, [orderId, 'order_retry_2b']),
    ).rejects.toThrow(/no payment awaiting checkout/);
  });
});

/** A prepaid order with no Razorpay order attached yet, as `create-payment` finds it. */
async function freshPrepaidOrder(label: string, method = 'razorpay'): Promise<string> {
  await db.asUser(campus.student);
  return placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity: 2 }],
    key: `rzp-${label}-${counter++}`,
    method,
  });
}

describe('begin_razorpay_payment', () => {
  it('lets the first Razorpay order win when two taps race', async () => {
    const orderId = await freshPrepaidOrder('race');

    await db.asOwner();
    const first = await db.query<{ id: string }>(
      `select public.begin_razorpay_payment($1::uuid, 'order_race_a') as id`,
      [orderId],
    );
    const second = await db.query<{ id: string }>(
      `select public.begin_razorpay_payment($1::uuid, 'order_race_b') as id`,
      [orderId],
    );

    // Both callers open the sheet on the same Razorpay order, so whichever one the
    // student pays on, the webhook finds our row. Before, the second overwrote the
    // first, and paying on the first sheet came back UNKNOWN_ORDER forever.
    expect(first.rows[0]!.id).toBe('order_race_a');
    expect(second.rows[0]!.id).toBe('order_race_a');
  });

  it('refuses an order the student already cancelled', async () => {
    const orderId = await freshPrepaidOrder('cancelled');
    await db.query(`select public.transition_order($1::uuid, 'cancelled', 'changed my mind')`, [
      orderId,
    ]);

    await db.asOwner();
    await expect(
      db.query(`select public.begin_razorpay_payment($1::uuid, 'order_too_late')`, [orderId]),
    ).rejects.toThrow(/INVALID_TRANSITION: .* is cancelled/);
  });

  it('refuses a cash order, which has nothing to open a sheet for', async () => {
    const orderId = await freshPrepaidOrder('cash', 'cod');

    await db.asOwner();
    await expect(
      db.query(`select public.begin_razorpay_payment($1::uuid, 'order_cash')`, [orderId]),
    ).rejects.toThrow(/no payment awaiting checkout/);
  });
});

describe('money that arrives after the order is gone', () => {
  it('is kept and reported as REFUND_REQUIRED, not dismissed as stale', async () => {
    const orderId = await prepaidOrder('order_late');
    const amount = (await paymentFor(orderId))!.amount_paise;

    // The student cancels while their bank is still processing.
    await db.asUser(campus.student);
    await db.query(`select public.transition_order($1::uuid, 'cancelled', 'changed my mind')`, [
      orderId,
    ]);

    expect(await record('order_late', 'pay_late', 'success', amount)).toBe('REFUND_REQUIRED');

    const payment = await paymentFor(orderId);
    // Still failed -- there is no legal move to success on a cancelled order -- but the
    // payment id is on the row, so the charge can be found and refunded.
    expect(payment?.status).toBe('failed');
    expect(payment?.provider_payment_id).toBe('pay_late');
    expect(payment?.failure_reason).toMatch(/refund required/);
    expect(await orderStatus(orderId)).toBe('cancelled');

    // A redelivery says the same thing again rather than something new.
    expect(await record('order_late', 'pay_late', 'success', amount)).toBe('REFUND_REQUIRED');
  });
});

describe('who hears about a prepaid order, and when', () => {
  async function notificationsFor(orderId: string, audience: string): Promise<number> {
    await db.asOwner();
    const { rows } = await db.query<{ n: string }>(
      `select count(*) as n from public.notifications
        where order_id = $1::uuid and audience = $2`,
      [orderId, audience],
    );
    return Number(rows[0]!.n);
  }

  it('tells nobody an order is placed while nobody has paid for it', async () => {
    const orderId = await prepaidOrder('order_quiet');
    expect(await notificationsFor(orderId, 'canteen')).toBe(0);
    // Not the student either. Found on the device: "Order placed" arrived while the
    // Razorpay sheet was still open, for an order that might never be paid.
    expect(await notificationsFor(orderId, 'student')).toBe(0);
  });

  it('tells a declined payment’s student nothing either — the order screen says it failed', async () => {
    const orderId = await prepaidOrder('order_declined');
    const amount = (await paymentFor(orderId))!.amount_paise;
    await record('order_declined', 'pay_declined', 'failed', amount, 'Card declined');
    expect(await notificationsFor(orderId, 'student')).toBe(0);
    expect(await notificationsFor(orderId, 'canteen')).toBe(0);
  });

  it('tells both the moment the money lands, and only once', async () => {
    const orderId = await prepaidOrder('order_loud');
    const amount = (await paymentFor(orderId))!.amount_paise;

    await record('order_loud', 'pay_loud', 'success', amount);
    const counterAfterPaid = await notificationsFor(orderId, 'canteen');
    expect(counterAfterPaid).toBeGreaterThan(0);
    expect(await notificationsFor(orderId, 'student')).toBe(1);

    await record('order_loud', 'pay_loud', 'success', amount); // Razorpay redelivers
    expect(await notificationsFor(orderId, 'canteen')).toBe(counterAfterPaid);
    expect(await notificationsFor(orderId, 'student')).toBe(1);
  });

  it('still tells the student about a cash order the moment it is placed', async () => {
    const orderId = await freshPrepaidOrder('cod-student', 'cod');
    expect(await notificationsFor(orderId, 'student')).toBe(1);
  });

  it('touches the order, which is what wakes every realtime subscriber', async () => {
    const orderId = await prepaidOrder('order_touch');
    const amount = (await paymentFor(orderId))!.amount_paise;

    await db.asOwner();
    // Back-dating needs the trigger out of the way, or it stamps now() over it.
    await db.query(`alter table public.orders disable trigger orders_touch`);
    await db.query(
      `update public.orders set updated_at = now() - interval '1 hour' where id = $1::uuid`,
      [orderId],
    );
    await db.query(`alter table public.orders enable trigger orders_touch`);

    await record('order_touch', 'pay_touch', 'success', amount);

    const { rows } = await db.query<{ fresh: boolean }>(
      `select updated_at > now() - interval '1 minute' as fresh
         from public.orders where id = $1::uuid`,
      [orderId],
    );
    expect(rows[0]!.fresh).toBe(true);
  });

  it('still pages the counter at placement for cash, which is work immediately', async () => {
    const orderId = await freshPrepaidOrder('cod-notify', 'cod');
    expect(await notificationsFor(orderId, 'canteen')).toBeGreaterThan(0);
  });
});

describe('expire_unpaid_orders', () => {
  it('leaves a fresh unpaid order alone', async () => {
    await prepaidOrder('order_exp_1');
    await db.asOwner();
    const { rows } = await db.query<{ n: number }>(
      `select public.expire_unpaid_orders(interval '15 minutes') as n`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('cancels one abandoned at checkout, and gives the coupon back', async () => {
    const orderId = await prepaidOrder('order_exp_2');

    // Back-date it past the window. The function reads `orders.created_at`, so this
    // is the same row it will judge.
    await db.asOwner();
    await db.query(
      `update public.orders set created_at = now() - interval '1 hour' where id = $1::uuid`,
      [orderId],
    );

    const { rows } = await db.query<{ n: number }>(
      `select public.expire_unpaid_orders(interval '15 minutes') as n`,
    );
    expect(rows[0]!.n).toBeGreaterThanOrEqual(1);

    expect(await orderStatus(orderId)).toBe('cancelled');
    const payment = await paymentFor(orderId);
    expect(payment?.status).toBe('failed');
    expect(payment?.failure_reason).toBe('abandoned at checkout');

    // Rule 12: a cancelled order consumes nothing.
    await db.asOwner();
    const { rows: redemptions } = await db.query<{ n: string }>(
      `select count(*) as n from public.coupon_redemptions where order_id = $1::uuid`,
      [orderId],
    );
    expect(Number(redemptions[0]!.n)).toBe(0);
  });

  it('writes the cancellation to the trail as the system, not as a person', async () => {
    const orderId = await prepaidOrder('order_exp_3');
    await db.asOwner();
    await db.query(
      `update public.orders set created_at = now() - interval '1 hour' where id = $1::uuid`,
      [orderId],
    );
    await db.query(`select public.expire_unpaid_orders(interval '15 minutes')`);

    const { rows } = await db.query<{ actor: string; actor_id: string | null; reason: string }>(
      `select actor, actor_id, reason from public.order_status_history
        where order_id = $1::uuid and to_status = 'cancelled'`,
      [orderId],
    );
    expect(rows[0]?.actor).toBe('system');
    expect(rows[0]?.actor_id).toBeNull();
    expect(rows[0]?.reason).toBe('payment not completed');
  });

  it('never touches a cash order, which has nothing to abandon', async () => {
    await db.asUser(campus.student);
    const cod = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      items: [{ item_id: maggi, quantity: 2 }],
      key: `rzp-cod-${counter++}`,
    });

    await db.asOwner();
    await db.query(
      `update public.orders set created_at = now() - interval '1 hour' where id = $1::uuid`,
      [cod],
    );
    await db.query(`select public.expire_unpaid_orders(interval '15 minutes')`);

    expect(await orderStatus(cod)).toBe('pending');
  });

  it('never touches an order the canteen already accepted', async () => {
    const orderId = await prepaidOrder('order_exp_4');
    const amount = (await paymentFor(orderId))!.amount_paise;
    await record('order_exp_4', 'pay_e4', 'success', amount);

    await db.asUser(campus.staff);
    await db.query(`select public.transition_order($1::uuid, 'accepted', null)`, [orderId]);

    await db.asOwner();
    await db.query(
      `update public.orders set created_at = now() - interval '1 hour' where id = $1::uuid`,
      [orderId],
    );
    await db.query(`select public.expire_unpaid_orders(interval '15 minutes')`);

    expect(await orderStatus(orderId)).toBe('accepted');
  });
});

describe('the payment state machine', () => {
  it('matches PAYMENT_TRANSITIONS in packages/shared exactly', async () => {
    // The same guarantee `order_transitions` has: the SQL copy is authoritative and the
    // TypeScript copy exists for UX, so drift has to fail here rather than in production.
    const { PAYMENT_STATUSES, canTransitionPayment } = await import('@canteza/shared');

    await db.asOwner();
    const { rows } = await db.query<{ from_status: string; to_status: string }>(
      `select from_status, to_status from public.payment_transitions`,
    );
    const inSql = new Set(rows.map((r) => `${r.from_status}->${r.to_status}`));

    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        expect(
          inSql.has(`${from}->${to}`),
          `${from} -> ${to} disagrees between SQL and packages/shared`,
        ).toBe(canTransitionPayment(from, to));
      }
    }
  });
});
