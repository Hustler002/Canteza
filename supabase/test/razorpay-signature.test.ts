import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  readPaymentOutcome,
  timingSafeEqual,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../functions/_shared/razorpay';

/**
 * Razorpay signature verification.
 *
 * The expected digests here are computed with Node's `createHmac`, deliberately — not
 * with the module under test. A test that signs with the same function it verifies with
 * proves only that the function agrees with itself, and would pass just as happily if
 * the algorithm were wrong in both directions. Node's crypto is the independent second
 * opinion, and it is the same HMAC-SHA256 Razorpay's own server-side libraries use.
 */

const WEBHOOK_SECRET = 'whsec_campus_test';
const KEY_SECRET = 'rzp_test_key_secret';

/** What Razorpay does, per its docs, computed independently of the module. */
function razorpayHmac(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

describe('webhook signature', () => {
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 34000 } } },
  });

  it('accepts a signature Razorpay would have produced', async () => {
    const signature = razorpayHmac(body, WEBHOOK_SECRET);
    await expect(verifyWebhookSignature(body, signature, WEBHOOK_SECRET)).resolves.toBe(true);
  });

  it('rejects a body altered by even one character', async () => {
    const signature = razorpayHmac(body, WEBHOOK_SECRET);
    const tampered = body.replace('34000', '1');
    await expect(verifyWebhookSignature(tampered, signature, WEBHOOK_SECRET)).resolves.toBe(false);
  });

  it('rejects a signature made with a different secret', async () => {
    const forged = razorpayHmac(body, 'whsec_not_ours');
    await expect(verifyWebhookSignature(body, forged, WEBHOOK_SECRET)).resolves.toBe(false);
  });

  it('rejects when the signature is missing', async () => {
    await expect(verifyWebhookSignature(body, null, WEBHOOK_SECRET)).resolves.toBe(false);
    await expect(verifyWebhookSignature(body, '', WEBHOOK_SECRET)).resolves.toBe(false);
  });

  it('rejects everything when the secret is not configured', async () => {
    // A function deployed without its secret must fail closed. Accepting unsigned
    // webhooks because the env var is missing is the worst possible default.
    const signature = razorpayHmac(body, WEBHOOK_SECRET);
    await expect(verifyWebhookSignature(body, signature, '')).resolves.toBe(false);
  });

  it('hashes the raw body, so re-serialising it breaks the signature', async () => {
    // Razorpay's docs: "Do not parse or cast the webhook request body." This is that
    // warning as a test — a round trip through JSON changes key order and whitespace.
    const signature = razorpayHmac(body, WEBHOOK_SECRET);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(reserialised).not.toBe(body);
    await expect(verifyWebhookSignature(reserialised, signature, WEBHOOK_SECRET)).resolves.toBe(
      false,
    );
  });
});

describe('checkout callback signature', () => {
  it('hashes order_id|payment_id with the key secret', async () => {
    const signature = razorpayHmac('order_9|pay_9', KEY_SECRET);
    await expect(verifyCheckoutSignature('order_9', 'pay_9', signature, KEY_SECRET)).resolves.toBe(
      true,
    );
  });

  it('is not interchangeable with the webhook signature', async () => {
    // Different message, different secret. Signing the pair with the webhook secret
    // must not validate, or the two verifiers have been wired to the wrong secrets.
    const wrongSecret = razorpayHmac('order_9|pay_9', WEBHOOK_SECRET);
    await expect(
      verifyCheckoutSignature('order_9', 'pay_9', wrongSecret, KEY_SECRET),
    ).resolves.toBe(false);
  });

  it('rejects a signature for a different order or payment', async () => {
    const signature = razorpayHmac('order_9|pay_9', KEY_SECRET);
    await expect(
      verifyCheckoutSignature('order_OTHER', 'pay_9', signature, KEY_SECRET),
    ).resolves.toBe(false);
    await expect(
      verifyCheckoutSignature('order_9', 'pay_OTHER', signature, KEY_SECRET),
    ).resolves.toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings and rejects differing ones', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('readPaymentOutcome', () => {
  const captured = {
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 34000 } },
    },
  };

  it('reads a captured payment as success, in paise, unconverted', () => {
    expect(readPaymentOutcome(captured)).toEqual({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      status: 'success',
      amountPaise: 34000,
      failureReason: null,
    });
  });

  it('reads a failed payment and carries its reason', () => {
    const outcome = readPaymentOutcome({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_2',
            order_id: 'order_2',
            amount: 34000,
            error_description: 'Card declined',
          },
        },
      },
    });
    expect(outcome?.status).toBe('failed');
    expect(outcome?.failureReason).toBe('Card declined');
  });

  it('ignores payment.authorized, which is money held rather than taken', () => {
    // Authorised is not captured. Treating it as paid would let a canteen cook for an
    // authorisation that is later voided and never settles.
    expect(readPaymentOutcome({ ...captured, event: 'payment.authorized' })).toBeNull();
  });

  it('ignores event types this app does not act on', () => {
    expect(readPaymentOutcome({ ...captured, event: 'subscription.charged' })).toBeNull();
  });

  it('ignores a malformed payload rather than inventing fields', () => {
    expect(readPaymentOutcome({ event: 'payment.captured' })).toBeNull();
    expect(
      readPaymentOutcome({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_3' } } },
      }),
    ).toBeNull();
  });
});
