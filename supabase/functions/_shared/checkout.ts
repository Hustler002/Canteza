/**
 * The decisions `create-payment` makes, kept apart from the Deno entrypoint for the same
 * reason `razorpay.ts` is: this file imports nothing, so vitest runs the exact code the
 * Edge Function runs. The entrypoint is left with I/O and nothing worth testing.
 *
 * What `create-payment` is for: the Razorpay sheet can only be opened against a Razorpay
 * order, and creating one needs the key *secret*, which must never be in an app bundle.
 * So the app asks this function, which re-reads the amount from our own `payments` row —
 * the client names an order and nothing else, and in particular never names a price.
 */

export type CheckoutOrder = {
  id: string;
  code: string;
  student_id: string;
  status: string;
};

export type CheckoutPayment = {
  method: string;
  status: string;
  amount_paise: number;
  provider_order_id: string | null;
};

/**
 * Error codes the app understands. Every one of them is also an `ErrorCode` in
 * `packages/shared/src/errors.ts`, so the client maps a response straight onto the
 * message it already shows for that code.
 */
export type CheckoutRefusal = {
  status: 400 | 401 | 404 | 409;
  code: 'UNAUTHENTICATED' | 'NOT_FOUND' | 'INVALID_TRANSITION' | 'DUPLICATE_REQUEST';
  message: string;
};

export type CheckoutDecision =
  | { ok: true; amountPaise: number; reuseProviderOrderId: string | null }
  | { ok: false; refusal: CheckoutRefusal };

/**
 * May this caller pay for this order, and how much?
 *
 * **Someone else's order is NOT_FOUND, not FORBIDDEN.** The function reads with the
 * service role, so it can see every order; answering "forbidden" would confirm to a
 * stranger that an order id exists. A canteen account can read the order through
 * `orders_read` and still gets NOT_FOUND here, because only the student pays.
 */
export function decideCheckout(
  userId: string,
  order: CheckoutOrder | null,
  payment: CheckoutPayment | null,
): CheckoutDecision {
  if (!order || !payment || order.student_id !== userId) {
    return refuse(404, 'NOT_FOUND', 'no such order');
  }
  if (payment.method === 'cod') {
    return refuse(409, 'INVALID_TRANSITION', 'this order is paid in cash');
  }
  if (payment.status === 'success' || payment.status === 'refunded') {
    // Already paid -- probably a second tap, or the webhook beat the sheet closing.
    return refuse(409, 'DUPLICATE_REQUEST', 'this order is already paid');
  }
  if (order.status !== 'pending') {
    // Cancelled by the student, expired by the sweep, or rejected. Nothing to pay for.
    return refuse(409, 'INVALID_TRANSITION', `this order is ${order.status}`);
  }

  return {
    ok: true,
    amountPaise: payment.amount_paise,
    // A Razorpay order takes further attempts until one is captured, so a retry after a
    // declined card goes back to the same one rather than minting a second bill.
    reuseProviderOrderId: payment.provider_order_id,
  };
}

function refuse(
  status: CheckoutRefusal['status'],
  code: CheckoutRefusal['code'],
  message: string,
): CheckoutDecision {
  return { ok: false, refusal: { status, code, message } };
}

/**
 * The body for `POST https://api.razorpay.com/v1/orders`.
 *
 * `amount` is paise, which is Razorpay's unit and ours (rule 1), so there is no
 * conversion and there must not be one. `receipt` is the human order code the counter
 * reads aloud, which is what a student sees on their bank statement and what support
 * searches for; Razorpay caps it at 40 characters. `notes.order_id` puts our id on
 * Razorpay's side of the record, so a payment in their dashboard leads straight back.
 */
export function razorpayOrderRequest(orderId: string, code: string, amountPaise: number) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    // Razorpay's minimum is 100 paise, and a zero-rupee order (a coupon that covered
    // everything) has nothing to collect. Never send either.
    throw new Error(`refusing to create a Razorpay order for ${amountPaise} paise`);
  }
  return {
    amount: amountPaise,
    currency: 'INR',
    receipt: code.slice(0, 40),
    notes: { order_id: orderId },
  };
}

/** HTTP Basic auth for Razorpay's API: key id as the user, key secret as the password. */
export function razorpayAuthHeader(keyId: string, keySecret: string): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

/** `Authorization: Bearer <jwt>` -> the jwt, or null. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  return match?.[1]?.trim() || null;
}

/** What the app needs to open the sheet. The key id is public; the secret never leaves. */
export type CheckoutSession = {
  keyId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
  orderCode: string;
};
