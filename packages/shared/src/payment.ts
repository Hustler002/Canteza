/**
 * Payment states are tracked separately from order states: an order can be `delivered`
 * while payment is still `pending` (cash on delivery), and a payment can be `refunded`
 * long after the order reached a terminal state.
 */
export const PAYMENT_STATUSES = ['initiated', 'pending', 'success', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['cod', 'razorpay'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  initiated: ['pending', 'success', 'failed'],
  pending: ['success', 'failed'],
  success: ['refunded'],
  failed: ['initiated'],
  refunded: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Cash is only ever collected by the partner at the door, so COD starts as pending. */
export function initialPaymentStatus(method: PaymentMethod): PaymentStatus {
  return method === 'cod' ? 'pending' : 'initiated';
}

/** The slice of a `payments` row a screen needs to say where the money is. */
export type PaymentSummary = {
  method: string;
  status: string;
  failure_reason?: string | null;
};

/**
 * A prepaid order the student has not finished paying for.
 *
 * This is the same condition `transition_order` refuses to accept with
 * PAYMENT_UNVERIFIED and `notify_order` withholds the counter's notification for, so the
 * three agree on one definition: the order is not work yet. The counter's board hides
 * it, and the student's tracker asks them to pay.
 *
 * Only a `pending` order can be waiting. Once the canteen has accepted it the money was
 * verified, and once it is cancelled there is nothing left to pay for.
 */
export function awaitingPayment(orderStatus: string, payment: PaymentSummary | null): boolean {
  return (
    orderStatus === 'pending' &&
    payment !== null &&
    payment.method !== 'cod' &&
    payment.status !== 'success'
  );
}

/**
 * How long the Razorpay sheet stays open before it gives up by itself.
 *
 * Deliberately shorter than the window `expire_unpaid_orders` is scheduled with (15
 * minutes in `supabase/functions/README.md`), so the sheet has always closed before the
 * sweep can cancel the order underneath it. A payment that still lands after a
 * cancellation is caught as REFUND_REQUIRED rather than lost, but it should be rare.
 */
export const CHECKOUT_TIMEOUT_SECONDS = 10 * 60;
