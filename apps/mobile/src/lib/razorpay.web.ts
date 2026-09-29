import { AppError, CHECKOUT_TIMEOUT_SECONDS, ERROR_CODES } from '@canteza/shared';
import type { CheckoutSession } from '@canteza/api';
import type { SheetPrefill, SheetResult } from './razorpay';

/**
 * The Razorpay sheet on the web, picked over `razorpay.ts` by Metro's `.web.ts`
 * resolution. Same two functions, same meaning, so checkout and the order screen do not
 * know which one they are talking to.
 *
 * `react-native-razorpay` is a native SDK; the web has Razorpay's own **Standard
 * Checkout**, a script served from Razorpay, loaded here on first use and never before --
 * a student who pays cash never downloads it. It opens against the same Razorpay order
 * `create-payment` made, with the same public key id it returned.
 *
 * **What the sheet reports is still a hint.** `handler` means the student finished; only
 * the `verify-payment` webhook marks an order paid (ADR 006), and the order screen watches
 * for that. A declined card does not close the sheet -- Razorpay keeps it open for another
 * try on the same order, which `record_payment_result` already accepts -- so the only
 * outcomes that end this promise are "finished" and "closed".
 *
 * **UPI appears only if the Razorpay account offers it.** Nothing here chooses methods;
 * the sheet shows what `GET /v1/methods` allows for the key, which today is `upi: false`.
 */

export const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

type RazorpayInstance = {
  open(): void;
  on(event: 'payment.failed', handler: (response: unknown) => void): void;
};
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

function razorpayGlobal(): RazorpayConstructor | undefined {
  return (globalThis as { Razorpay?: RazorpayConstructor }).Razorpay;
}

let loading: Promise<void> | null = null;

/** Load checkout.js once. A failed load is forgotten, so the next tap tries again. */
export function loadCheckoutScript(): Promise<void> {
  if (razorpayGlobal()) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new AppError(ERROR_CODES.PAYMENT_UNAVAILABLE, { raw: 'checkout.js failed to load' }));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Any browser can run the web checkout; what it offers is up to the Razorpay account. */
export function isOnlinePaymentAvailable(): boolean {
  return typeof document !== 'undefined';
}

export async function openRazorpaySheet(
  session: CheckoutSession,
  options: { brandName: string; description: string; color: string; prefill: SheetPrefill },
): Promise<SheetResult> {
  await loadCheckoutScript();
  const Razorpay = razorpayGlobal();
  if (!Razorpay) {
    throw new AppError(ERROR_CODES.PAYMENT_UNAVAILABLE, { raw: 'checkout.js loaded no Razorpay' });
  }

  return new Promise<SheetResult>((resolve) => {
    const sheet = new Razorpay({
      key: session.keyId,
      order_id: session.providerOrderId,
      amount: session.amountPaise,
      currency: session.currency,
      name: options.brandName,
      description: options.description,
      prefill: compact(options.prefill),
      theme: { color: options.color },
      notes: { order_code: session.orderCode },
      // Closes itself before `expire_unpaid_orders` could cancel the order underneath.
      timeout: CHECKOUT_TIMEOUT_SECONDS,
      handler: (response: { razorpay_payment_id?: string }) =>
        resolve({ kind: 'submitted', paymentId: response.razorpay_payment_id ?? '' }),
      modal: {
        ondismiss: () => resolve({ kind: 'closed' }),
        // Ask before closing mid-payment: a UPI collect request may still be pending.
        confirm_close: true,
      },
    });
    // Deliberately nothing: the sheet stays open for another attempt, and the webhook
    // records the failure with Razorpay's own reason for the order screen to show.
    sheet.on('payment.failed', () => undefined);
    sheet.open();
  });
}

/** Razorpay renders an empty string as an empty field; leave unknowns out entirely. */
function compact(prefill: SheetPrefill): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(prefill)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}
