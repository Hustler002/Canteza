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
