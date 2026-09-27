import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  readPaymentOutcome,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from '../_shared/razorpay.ts';

/**
 * Razorpay's webhook. ADR 006 calls this the verification seam, and it is the only
 * thing in the system that may declare a payment successful.
 *
 * The order of operations is the security property:
 *
 *   1. read the body as **text**, never as JSON — the signature is over the exact
 *      bytes, and `await req.json()` destroys them (Razorpay's docs are explicit);
 *   2. verify the HMAC before looking at a single field;
 *   3. only then parse, and hand the outcome to `record_payment_result`, which
 *      re-checks the amount and the state machine anyway.
 *
 * The client's own Razorpay callback is *not* trusted and does not reach here. The app
 * treats it as a hint to refetch, which is why a student force-quitting mid-payment
 * loses nothing: this webhook still arrives.
 *
 * On status codes, which matter more than usual because Razorpay retries anything that
 * is not 2xx until it gives up:
 *   - a duplicate, a stale event or an event we ignore  -> 200, stop retrying;
 *   - an unknown order (the webhook outran our commit)  -> 409, please retry;
 *   - a bad signature                                   -> 401, never retry;
 *   - our own failure                                   -> 500, retry.
 */

const WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Fail closed. A function deployed without its secret must reject everything rather
  // than wave payments through.
  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('verify-payment is missing required environment variables');
    return json({ error: 'not configured' }, 500);
  }

  // Text, not json(). This is the whole signature check.
  const rawBody = await req.text();
  const signature = req.headers.get(WEBHOOK_SIGNATURE_HEADER);

  if (!(await verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET))) {
    // Deliberately terse: an attacker learns nothing about why it failed.
    console.warn('verify-payment rejected a webhook with an invalid signature');
    return json({ error: 'invalid signature' }, 401);
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    // Signed but unparseable should never happen; retrying will not fix it.
    return json({ error: 'malformed body' }, 400);
  }

  const outcome = readPaymentOutcome(event as never);
  if (!outcome) {
    // Razorpay sends many event types. One we do not act on is acknowledged so it is
    // not retried — `payment.authorized` lands here on purpose, because authorised
    // money is held rather than taken.
    return json({ ignored: true }, 200);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('record_payment_result', {
    p_provider_order_id: outcome.providerOrderId,
    p_provider_payment_id: outcome.providerPaymentId,
    p_status: outcome.status,
    p_amount_paise: outcome.amountPaise,
    p_failure_reason: outcome.failureReason,
  });

  if (error) {
    // An amount mismatch or an undefined result raises, and is ours to investigate.
    console.error('record_payment_result failed', error.message);
    return json({ error: 'could not record payment' }, 500);
  }

  if (data === 'REFUND_REQUIRED') {
    // Real money against an order that is no longer open: paid in the same moment it
    // was cancelled, or after the sweep expired it. The row now carries the payment id
    // and says so in `failure_reason`. 200, because retrying changes nothing -- this
    // needs a person, and this log line is how they find out.
    console.error('REFUND REQUIRED', outcome.providerOrderId, outcome.providerPaymentId);
    return json({ result: data }, 200);
  }

  if (data === 'UNKNOWN_ORDER') {
    // Not an error: the webhook can outrun our own transaction. 409 asks Razorpay to
    // come back, which it will.
    return json({ result: data }, 409);
  }

  return json({ result: data }, 200);
});
