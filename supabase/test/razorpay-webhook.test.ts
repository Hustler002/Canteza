import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readPaymentOutcome,
  verifyWebhookSignature,
  type RazorpayWebhookEvent,
} from '../functions/_shared/razorpay';
import { createTestDb, menuItem, placeOrder, seedCampus, type Campus, type Db } from './harness';

/**
 * The webhook end to end, minus the HTTP.
 *
 * `verify-payment/index.ts` is a Deno file and cannot run here, so this exercises the
 * two halves it is made of — signature verification and `record_payment_result` —
 * wired together in the same order and with the same decisions. What it cannot prove
 * is the Deno runtime, the deployment or Razorpay's real traffic; what it can prove is
 * that a forged webhook never reaches the database, and that a genuine one moves the
 * money exactly once.
 *
 * The handler's status codes are asserted here as the decision each outcome maps to,
 * because they are a real part of the contract: Razorpay retries anything that is not
 * 2xx, so answering 500 to a duplicate would produce an infinite retry loop.
 */

const WEBHOOK_SECRET = 'whsec_campus_test';

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

async function prepaidOrder(providerOrderId: string): Promise<{ id: string; amount: number }> {
  await db.asUser(campus.student);
  const id = await placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity: 2 }],
    key: `hook-${counter++}`,
    method: 'razorpay',
  });

  await db.asOwner();
  await db.query(`select public.begin_razorpay_payment($1::uuid, $2)`, [id, providerOrderId]);
  const { rows } = await db.query<{ amount_paise: number }>(
    `select amount_paise from public.payments where order_id = $1::uuid`,
    [id],
  );
  return { id, amount: rows[0]!.amount_paise };
}

function capturedEvent(orderId: string, paymentId: string, amount: number): RazorpayWebhookEvent {
  return {
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount } } },
  };
}

/**
 * The handler, reimplemented in the order `verify-payment/index.ts` does it.
 *
 * Deliberately mirrors that file rather than importing it: importing would mean
 * running Deno. The value is in pinning the *sequence* — signature first, on the raw
 * text, before anything looks at a field.
 */
async function handle(
  rawBody: string,
  signature: string | null,
): Promise<{ status: number; result: string }> {
  if (!(await verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET))) {
    return { status: 401, result: 'invalid signature' };
  }

  let parsed: RazorpayWebhookEvent;
  try {
    parsed = JSON.parse(rawBody) as RazorpayWebhookEvent;
  } catch {
    return { status: 400, result: 'malformed body' };
  }

  const outcome = readPaymentOutcome(parsed);
  if (!outcome) return { status: 200, result: 'ignored' };

  await db.asOwner();
  const { rows } = await db.query<{ result: string }>(
    `select public.record_payment_result($1, $2, $3, $4, $5) as result`,
    [
      outcome.providerOrderId,
      outcome.providerPaymentId,
      outcome.status,
      String(outcome.amountPaise),
      outcome.failureReason,
    ],
  );
  const result = rows[0]!.result;
  return { status: result === 'UNKNOWN_ORDER' ? 409 : 200, result };
}

const sign = (body: string) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

async function paymentStatus(orderId: string): Promise<string> {
  await db.asOwner();
  const { rows } = await db.query<{ status: string }>(
    `select status from public.payments where order_id = $1::uuid`,
    [orderId],
  );
  return rows[0]!.status;
}

describe('the webhook, signature through to database', () => {
  it('pays an order when the signature is genuine', async () => {
    const order = await prepaidOrder('hook_order_1');
    const body = JSON.stringify(capturedEvent('hook_order_1', 'hook_pay_1', order.amount));

    expect(await handle(body, sign(body))).toEqual({ status: 200, result: 'PAID' });
    expect(await paymentStatus(order.id)).toBe('success');
  });

  it('never reaches the database with a forged signature', async () => {
    const order = await prepaidOrder('hook_order_2');
    const body = JSON.stringify(capturedEvent('hook_order_2', 'hook_pay_2', order.amount));
    const forged = createHmac('sha256', 'not-our-secret').update(body).digest('hex');

    expect(await handle(body, forged)).toEqual({ status: 401, result: 'invalid signature' });
    // The decisive assertion: the payment is untouched, so the forgery stopped at the
    // signature rather than being caught later by some downstream check.
    expect(await paymentStatus(order.id)).toBe('initiated');
  });

  it('rejects a body edited after signing, even by one digit', async () => {
    const order = await prepaidOrder('hook_order_3');
    const body = JSON.stringify(capturedEvent('hook_order_3', 'hook_pay_3', order.amount));
    const signature = sign(body);

    // The classic attack: take a real webhook and change the amount.
    const tampered = body.replace(String(order.amount), '100');
    expect(await handle(tampered, signature)).toEqual({ status: 401, result: 'invalid signature' });
    expect(await paymentStatus(order.id)).toBe('initiated');
  });

  it('answers 200 to a duplicate so Razorpay stops retrying', async () => {
    const order = await prepaidOrder('hook_order_4');
    const body = JSON.stringify(capturedEvent('hook_order_4', 'hook_pay_4', order.amount));
    const signature = sign(body);

    expect((await handle(body, signature)).result).toBe('PAID');
    const second = await handle(body, signature);

    expect(second.status).toBe(200);
    expect(second.result).toBe('ALREADY_RECORDED');
  });

  it('answers 409 to an event that outran our own commit', async () => {
    const body = JSON.stringify(capturedEvent('hook_order_never', 'hook_pay_x', 8000));
    expect(await handle(body, sign(body))).toEqual({ status: 409, result: 'UNKNOWN_ORDER' });
  });

  it('acknowledges an event it does not act on', async () => {
    const body = JSON.stringify({
      ...capturedEvent('hook_order_1', 'hook_pay_auth', 8000),
      event: 'payment.authorized',
    });
    expect(await handle(body, sign(body))).toEqual({ status: 200, result: 'ignored' });
  });

  it('records a failed payment and leaves the order unaccepted', async () => {
    const order = await prepaidOrder('hook_order_5');
    const body = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'hook_pay_5',
            order_id: 'hook_order_5',
            amount: order.amount,
            error_description: 'Insufficient funds',
          },
        },
      },
    });

    expect((await handle(body, sign(body))).result).toBe('FAILED');
    expect(await paymentStatus(order.id)).toBe('failed');

    await db.asOwner();
    const { rows } = await db.query<{ status: string; failure_reason: string }>(
      `select o.status, p.failure_reason from public.orders o
         join public.payments p on p.order_id = o.id where o.id = $1::uuid`,
      [order.id],
    );
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.failure_reason).toBe('Insufficient funds');
  });
});
