import { describe, expect, it } from 'vitest';
import { checkoutError } from '../src/payments';
import { paymentOf } from '../src/orders';

/**
 * The client's half of a payment is small on purpose -- ask, then look at the order --
 * so what is worth pinning is the translation: every way `create-payment` can say no
 * has to arrive as a message this app already knows how to show.
 */

function httpError(status: number, body: unknown) {
  return {
    name: 'FunctionsHttpError',
    context: new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  };
}

describe('checkoutError', () => {
  it('keeps the code the function answered with', async () => {
    const err = await checkoutError(
      httpError(409, { error: { code: 'DUPLICATE_REQUEST', message: 'already paid' } }),
    );
    expect(err.code).toBe('DUPLICATE_REQUEST');
  });

  it('says online payment is unavailable when the function is not configured', async () => {
    const err = await checkoutError(
      httpError(503, { error: { code: 'PAYMENT_UNAVAILABLE', message: 'not configured' } }),
    );
    expect(err.code).toBe('PAYMENT_UNAVAILABLE');
  });

  it('says the same for a function that was never deployed, which answers with no JSON', async () => {
    const err = await checkoutError(httpError(404, 'Function not found'));
    expect(err.code).toBe('PAYMENT_UNAVAILABLE');
  });

  it('does not trust a code this app has never heard of', async () => {
    const err = await checkoutError(
      httpError(500, { error: { code: 'DROP_TABLE', message: 'x' } }),
    );
    expect(err.code).toBe('PAYMENT_UNAVAILABLE');
  });

  it('calls a request that never arrived a network problem', async () => {
    const err = await checkoutError({ name: 'FunctionsFetchError', context: new Error('offline') });
    expect(err.code).toBe('NETWORK');
  });
});

describe('paymentOf', () => {
  const summary = { method: 'razorpay', status: 'initiated' };

  it('reads the embed whichever shape PostgREST chose', () => {
    expect(paymentOf({ payments: summary })).toEqual(summary);
    expect(paymentOf({ payments: [summary] })).toEqual(summary);
  });

  it('is null when there is nothing embedded', () => {
    expect(paymentOf({ payments: null })).toBeNull();
    expect(paymentOf({ payments: [] })).toBeNull();
    expect(paymentOf({})).toBeNull();
  });
});
