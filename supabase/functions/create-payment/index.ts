import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  bearerToken,
  decideCheckout,
  razorpayAuthHeader,
  razorpayOrderRequest,
  type CheckoutSession,
} from '../_shared/checkout.ts';

/**
 * Opens a Razorpay payment for one of the caller's own orders.
 *
 * The app sends `{ orderId }` and nothing else. The amount comes from our `payments` row,
 * written by `place_order` from prices it re-read itself (rule 4), so no client ever
 * names what it is charged. The key secret stays here; the app receives only the public
 * key id and the Razorpay order to open the sheet against.
 *
 * This function never declares a payment successful. That is `verify-payment`'s job
 * alone (ADR 006) -- this one only arranges for there to be something to pay.
 *
 * Deployed with JWT verification **off** at the gateway, and verifies the caller itself
 * with `auth.getUser()`. That asks the Auth server rather than checking a signature
 * locally, so it works whichever JWT signing keys the project uses; the gateway's own
 * check only understands the legacy shared secret. It is not weaker: an unauthenticated
 * call gets a 401 from this function instead of from the gateway.
 */

const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// supabase-js's `functions.invoke` sends these from a browser; a phone does not need
// CORS, but answering the preflight costs nothing and keeps the admin app an option.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'UNKNOWN', 'method not allowed');

  // Fail closed, and say which kind of failure it is: the app shows "online payment
  // is unavailable" for this code rather than a generic error.
  if (!KEY_ID || !KEY_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('create-payment is missing required environment variables');
    return fail(503, 'PAYMENT_UNAVAILABLE', 'not configured');
  }

  const token = bearerToken(req.headers.get('authorization'));
  if (!token) return fail(401, 'UNAUTHENTICATED', 'sign in first');

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return fail(401, 'UNAUTHENTICATED', 'sign in first');

  let orderId: unknown;
  try {
    orderId = (await req.json())?.orderId;
  } catch {
    return fail(400, 'NOT_FOUND', 'expected { orderId }');
  }
  if (typeof orderId !== 'string' || !UUID.test(orderId)) {
    return fail(400, 'NOT_FOUND', 'expected { orderId }');
  }

  const [{ data: order, error: orderError }, { data: payment, error: paymentError }] =
    await Promise.all([
      admin.from('orders').select('id, code, student_id, status').eq('id', orderId).maybeSingle(),
      admin
        .from('payments')
        .select('method, status, amount_paise, provider_order_id')
        .eq('order_id', orderId)
        .maybeSingle(),
    ]);
  if (orderError || paymentError) {
    console.error('create-payment could not read the order', orderError ?? paymentError);
    return fail(500, 'UNKNOWN', 'could not read the order');
  }

  const decision = decideCheckout(auth.user.id, order, payment);
  if (!decision.ok) {
    return fail(decision.refusal.status, decision.refusal.code, decision.refusal.message);
  }

  let providerOrderId = decision.reuseProviderOrderId;

  if (!providerOrderId) {
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        authorization: razorpayAuthHeader(KEY_ID, KEY_SECRET),
        'content-type': 'application/json',
      },
      body: JSON.stringify(razorpayOrderRequest(order!.id, order!.code, decision.amountPaise)),
    });

    if (!response.ok) {
      // A 401 here is almost always a key id and secret from different modes, or a
      // secret pasted with whitespace. Logged for the operator; never shown to a student.
      console.error('Razorpay refused to create an order', response.status, await response.text());
      return fail(502, 'PAYMENT_UNAVAILABLE', 'the payment provider refused the request');
    }

    const created = (await response.json()) as { id?: string };
    if (!created.id) {
      console.error('Razorpay created an order with no id');
      return fail(502, 'PAYMENT_UNAVAILABLE', 'the payment provider sent no order id');
    }
    providerOrderId = created.id;
  }

  // Attach it, or learn which one is already attached. If two taps raced, both created
  // a Razorpay order and the first to get here won; the other is simply never paid.
  const { data: effective, error: beginError } = await admin.rpc('begin_razorpay_payment', {
    p_order_id: order!.id,
    p_provider_order_id: providerOrderId,
  });
  if (beginError || typeof effective !== 'string') {
    // The order was cancelled between our read and this call, most likely. The SQL
    // raised 'CODE: detail', and the code is the part the app can use.
    const code = beginError?.message.split(':')[0]?.trim() || 'UNKNOWN';
    return fail(409, code, beginError?.message ?? 'could not start the payment');
  }

  const session: CheckoutSession = {
    keyId: KEY_ID,
    providerOrderId: effective,
    amountPaise: decision.amountPaise,
    currency: 'INR',
    orderCode: order!.code,
  };
  return json(session, 200);
});
