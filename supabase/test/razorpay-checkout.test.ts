import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  decideCheckout,
  razorpayAuthHeader,
  razorpayOrderRequest,
  type CheckoutOrder,
  type CheckoutPayment,
} from '../functions/_shared/checkout';

/**
 * `create-payment`'s decisions, run as the exact file the Edge Function imports.
 *
 * The function holds the service role key and so can read every order on the platform.
 * These are the checks standing between that and a stranger opening a sheet on someone
 * else's bill, or a student paying twice, or paying for an order that no longer exists.
 */

const STUDENT = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';

const order = (over: Partial<CheckoutOrder> = {}): CheckoutOrder => ({
  id: '33333333-3333-4333-8333-333333333333',
  code: 'CZ-4821',
  student_id: STUDENT,
  status: 'pending',
  ...over,
});

const payment = (over: Partial<CheckoutPayment> = {}): CheckoutPayment => ({
  method: 'razorpay',
  status: 'initiated',
  amount_paise: 9000,
  provider_order_id: null,
  ...over,
});

describe('decideCheckout', () => {
  it('lets the student pay for their own unpaid order, at the amount on our row', () => {
    expect(decideCheckout(STUDENT, order(), payment())).toEqual({
      ok: true,
      amountPaise: 9000,
      reuseProviderOrderId: null,
    });
  });

  it('answers NOT_FOUND for someone else’s order, so an id’s existence is not confirmed', () => {
    const decision = decideCheckout(STRANGER, order(), payment());
    expect(decision).toMatchObject({ ok: false, refusal: { status: 404, code: 'NOT_FOUND' } });
  });

  it('answers NOT_FOUND for a missing order or a missing payment row', () => {
    expect(decideCheckout(STUDENT, null, payment())).toMatchObject({ ok: false });
    expect(decideCheckout(STUDENT, order(), null)).toMatchObject({ ok: false });
  });

  it('refuses a cash order', () => {
    expect(
      decideCheckout(STUDENT, order(), payment({ method: 'cod', status: 'pending' })),
    ).toMatchObject({ ok: false, refusal: { code: 'INVALID_TRANSITION' } });
  });

  it('refuses an order that is already paid, which is a second tap and not an error', () => {
    for (const status of ['success', 'refunded']) {
      expect(decideCheckout(STUDENT, order(), payment({ status }))).toMatchObject({
        ok: false,
        refusal: { status: 409, code: 'DUPLICATE_REQUEST' },
      });
    }
  });

  it('refuses an order that is no longer pending — cancelled, expired or rejected', () => {
    for (const status of ['cancelled', 'rejected', 'accepted']) {
      expect(
        decideCheckout(STUDENT, order({ status }), payment({ status: 'failed' })),
      ).toMatchObject({ ok: false, refusal: { code: 'INVALID_TRANSITION' } });
    }
  });

  it('hands back the attached Razorpay order, so a retry is the same bill', () => {
    const decision = decideCheckout(
      STUDENT,
      order(),
      payment({ status: 'failed', provider_order_id: 'order_Nx1' }),
    );
    expect(decision).toEqual({ ok: true, amountPaise: 9000, reuseProviderOrderId: 'order_Nx1' });
  });
});

describe('razorpayOrderRequest', () => {
  it('sends paise as paise, with our id on their record', () => {
    expect(razorpayOrderRequest('abc', 'CZ-4821', 9000)).toEqual({
      amount: 9000,
      currency: 'INR',
      receipt: 'CZ-4821',
      notes: { order_id: 'abc' },
    });
  });

  it('keeps the receipt inside Razorpay’s 40-character limit', () => {
    expect(razorpayOrderRequest('abc', 'X'.repeat(60), 9000).receipt).toHaveLength(40);
  });

  it('refuses an amount that is not a positive whole number of paise', () => {
    for (const amount of [0, -100, 90.5, Number.NaN]) {
      expect(() => razorpayOrderRequest('abc', 'CZ-1', amount)).toThrow(/refusing/);
    }
  });
});

describe('razorpayAuthHeader', () => {
  it('is HTTP Basic over key id and secret, checked against Node’s own base64', () => {
    const expected = `Basic ${Buffer.from('rzp_test_abc:s3cret').toString('base64')}`;
    expect(razorpayAuthHeader('rzp_test_abc', 's3cret')).toBe(expected);
  });
});

describe('bearerToken', () => {
  it('reads the token out of an Authorization header', () => {
    expect(bearerToken('Bearer eyJhbGciOi.x.y')).toBe('eyJhbGciOi.x.y');
    expect(bearerToken('bearer   tok ')).toBe('tok');
  });

  it('returns null for anything else', () => {
    for (const header of [null, '', 'Bearer', 'Bearer   ', 'Basic abc', 'tok']) {
      expect(bearerToken(header)).toBeNull();
    }
  });
});
