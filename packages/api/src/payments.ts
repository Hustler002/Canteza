import { AppError, ERROR_CODES, type ErrorCode } from '@canteza/shared';
import type { CampusClient } from './client';

/**
 * Online payment, the client's half.
 *
 * The client's whole part in a payment is to ask for one and then look at the order.
 * It never tells the server a payment succeeded: the Razorpay sheet's success callback
 * is a hint to start watching, and only the `verify-payment` webhook moves money
 * (ADR 006). That is why nothing in this file writes to `payments` -- nothing could.
 */

/** What `create-payment` hands back: enough to open the Razorpay sheet, no more. */
export type CheckoutSession = {
  /** Razorpay's public key id. Safe in a bundle; the secret never leaves the server. */
  keyId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
  orderCode: string;
};

export const CREATE_PAYMENT_FUNCTION = 'create-payment';

/**
 * Ask the server for a Razorpay order to pay this order with.
 *
 * Sends the order id and nothing else. The amount comes from the `payments` row
 * `place_order` wrote, so a patched client cannot choose what it is charged.
 */
export async function startCheckout(
  client: CampusClient,
  orderId: string,
): Promise<CheckoutSession> {
  const { data, error } = await client.functions.invoke<CheckoutSession>(CREATE_PAYMENT_FUNCTION, {
    body: { orderId },
  });

  if (error) throw await checkoutError(error);
  if (!data || typeof data.providerOrderId !== 'string' || typeof data.keyId !== 'string') {
    throw new AppError(ERROR_CODES.PAYMENT_UNAVAILABLE, { raw: 'malformed checkout session' });
  }
  return data;
}

/**
 * The function answers `{ error: { code, message } }`, with a code this app already
 * knows. supabase-js wraps a non-2xx in a FunctionsHttpError whose `context` is the raw
 * Response, so the body has to be read back out of it.
 */
export async function checkoutError(error: unknown): Promise<AppError> {
  const name = (error as { name?: string }).name;

  // Never reached the function at all: no connection, or DNS.
  if (name === 'FunctionsFetchError') {
    return new AppError(ERROR_CODES.NETWORK, { raw: String(error) });
  }

  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as Response).json === 'function') {
    const response = context as Response;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      const code = body.error?.code;
      if (code && code in ERROR_CODES) {
        return new AppError(code as ErrorCode, {
          status: response.status,
          raw: body.error?.message,
        });
      }
    } catch {
      // Not our JSON -- a 404 from a function that was never deployed, most likely.
    }
    return new AppError(ERROR_CODES.PAYMENT_UNAVAILABLE, { status: response.status });
  }

  return new AppError(ERROR_CODES.PAYMENT_UNAVAILABLE, { raw: String(error) });
}
