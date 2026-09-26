/**
 * Razorpay signature verification.
 *
 * Deliberately written against Web Crypto and nothing else, so the exact file that runs
 * in the Deno Edge Function is the file the vitest suite imports and exercises under
 * Node. A second, Node-flavoured copy for testing would be a copy that can drift from
 * the one actually guarding the money.
 *
 * **There are two different signatures and they are not interchangeable.** Confusing
 * them is the classic way to ship a verifier that always fails, or worse, one that
 * validates against a secret an attacker can obtain:
 *
 *   1. **Webhook** — `HMAC_SHA256(raw_request_body, WEBHOOK_SECRET)`, sent in the
 *      `X-Razorpay-Signature` header. The body must be hashed exactly as received:
 *      Razorpay's own docs warn "Do not parse or cast the webhook request body", because
 *      `JSON.parse` followed by `JSON.stringify` re-orders keys and changes whitespace,
 *      and the bytes no longer match.
 *
 *   2. **Checkout callback** — `HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)`,
 *      returned to the app as `razorpay_signature`. A different message *and* a
 *      different secret.
 *
 * The webhook is the source of truth; the callback is a fast path that lets the app stop
 * spinning. A student who force-quits mid-payment produces no callback at all and the
 * webhook still arrives, which is exactly why the order flow never waits on the callback.
 */

export const WEBHOOK_SIGNATURE_HEADER = 'x-razorpay-signature';

const encoder = new TextEncoder();

/** Lowercase hex, which is the form Razorpay sends. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/**
 * Constant-time comparison.
 *
 * `a === b` on a signature leaks where the first mismatching byte is, which over enough
 * attempts is enough to forge one byte at a time. Comparing every character and OR-ing
 * the differences takes the same time whatever the input. The length check before it is
 * not a leak worth caring about: a hex SHA-256 digest is always 64 characters, so length
 * carries no secret.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verify a webhook. `rawBody` must be the untouched request text.
 *
 * An empty secret returns false rather than throwing: a misconfigured function must
 * reject every webhook, not accept them, and must not crash in a way that makes Razorpay
 * retry forever.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  webhookSecret: string,
): Promise<boolean> {
  if (!signature || !webhookSecret) return false;
  return timingSafeEqual(await hmacSha256Hex(rawBody, webhookSecret), signature.trim());
}

/** Verify the `razorpay_signature` the checkout hands back to the app. */
export async function verifyCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string | null | undefined,
  keySecret: string,
): Promise<boolean> {
  if (!signature || !keySecret || !razorpayOrderId || !razorpayPaymentId) return false;
  const expected = await hmacSha256Hex(`${razorpayOrderId}|${razorpayPaymentId}`, keySecret);
  return timingSafeEqual(expected, signature.trim());
}

/* -------------------------------------------------------------------------- */

/** The slice of a Razorpay webhook this app acts on. */
export type RazorpayWebhookEvent = {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        amount?: number;
        error_description?: string;
        error_reason?: string;
      };
    };
  };
};

export type PaymentOutcome = {
  providerOrderId: string;
  providerPaymentId: string;
  status: 'success' | 'failed';
  amountPaise: number;
  failureReason: string | null;
};

/**
 * The events worth acting on, and what each one means for `payments.status`.
 *
 * `payment.captured` is the only success: `payment.authorized` means the money is held
 * but not taken, and treating it as paid would let a kitchen cook for an authorisation
 * that is later voided. Anything not listed here is acknowledged and ignored — Razorpay
 * sends many event types and an unrecognised one is not an error.
 */
const EVENT_STATUS: Record<string, 'success' | 'failed'> = {
  'payment.captured': 'success',
  'payment.failed': 'failed',
};

/** Returns null for an event this app does not act on. */
export function readPaymentOutcome(event: RazorpayWebhookEvent): PaymentOutcome | null {
  const status = EVENT_STATUS[event.event];
  if (!status) return null;

  const entity = event.payload?.payment?.entity;
  if (!entity?.id || !entity.order_id || typeof entity.amount !== 'number') return null;

  return {
    providerOrderId: entity.order_id,
    providerPaymentId: entity.id,
    status,
    // Razorpay amounts are already in paise, which is the unit this codebase uses
    // everywhere (rule 1) — so there is no conversion here, and there must not be one.
    amountPaise: entity.amount,
    failureReason:
      status === 'failed'
        ? (entity.error_description ?? entity.error_reason ?? 'payment failed')
        : null,
  };
}
