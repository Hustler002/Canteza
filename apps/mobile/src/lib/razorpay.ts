import { NativeModules, TurboModuleRegistry } from 'react-native';
import { AppError, CHECKOUT_TIMEOUT_SECONDS, ERROR_CODES } from '@canteza/shared';
import type { CheckoutSession } from '@canteza/api';

/**
 * The Razorpay sheet, and the only file that knows `react-native-razorpay` exists.
 *
 * **The package is never imported at the top of a module.** Its entry file constructs a
 * `NativeEventEmitter` the moment it is evaluated, which throws on iOS when the native
 * module is missing -- and it is missing in Expo Go, and in any development build made
 * before the package was installed. A static import would take the checkout screen down
 * with it. So availability is asked of the module registry first, without touching the
 * package, and the package is loaded only once it is known to be there.
 *
 * **What the sheet reports is a hint, never a verdict.** Its success callback says the
 * student finished the flow; it does not say money moved, and nothing here tells the
 * server anything. The order screen watches the order, and only the `verify-payment`
 * webhook can mark it paid (ADR 006). A student who force-quits mid-payment produces no
 * callback at all, and loses nothing.
 */

const NATIVE_MODULE = 'RNRazorpayCheckout';

/** Is the native checkout compiled into this build? */
export function isOnlinePaymentAvailable(): boolean {
  try {
    return Boolean(TurboModuleRegistry.get(NATIVE_MODULE) ?? NativeModules[NATIVE_MODULE]);
  } catch {
    return false;
  }
}

export type SheetPrefill = {
  name?: string | null;
  email?: string | null;
  contact?: string | null;
};

/**
 * What the student did in the sheet.
 *
 * `submitted` -- they completed it; the webhook will confirm or refute it shortly.
 * `closed`    -- they backed out, or the attempt failed inside the sheet. Either way the
 *                order is still there to pay for, which is all the app needs to know;
 *                a declined card is reported by the webhook with Razorpay's own reason.
 */
export type SheetResult = { kind: 'submitted'; paymentId: string } | { kind: 'closed' };

export async function openRazorpaySheet(
  session: CheckoutSession,
  options: { brandName: string; description: string; color: string; prefill: SheetPrefill },
): Promise<SheetResult> {
  if (!isOnlinePaymentAvailable()) {
    throw new AppError(ERROR_CODES.PAYMENT_UNAVAILABLE, { raw: 'native module missing' });
  }

  const { default: RazorpayCheckout } = await import('react-native-razorpay');

  try {
    const data = await RazorpayCheckout.open({
      key: session.keyId,
      order_id: session.providerOrderId,
      // Razorpay renders this, so it must agree with the order it is paying -- which it
      // does, because both came from the same `payments` row on the server.
      amount: session.amountPaise,
      currency: session.currency,
      name: options.brandName,
      description: options.description,
      prefill: compact(options.prefill),
      theme: { color: options.color },
      // Closes itself before `expire_unpaid_orders` could cancel the order underneath.
      timeout: CHECKOUT_TIMEOUT_SECONDS,
      notes: { order_code: session.orderCode },
    });
    return { kind: 'submitted', paymentId: data.razorpay_payment_id };
  } catch {
    // Cancelled, declined, timed out or a network drop. The codes differ between the
    // Android and iOS SDKs, and the app acts the same on all of them: show the order,
    // which says what the server knows.
    return { kind: 'closed' };
  }
}

/** Razorpay renders an empty string as an empty field; leave unknowns out entirely. */
function compact(prefill: SheetPrefill): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(prefill)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}
