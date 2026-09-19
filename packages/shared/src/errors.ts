/**
 * Every failure the user can hit has a stable code, a safe user-facing message,
 * and optional technical details that stay out of the UI.
 */
export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CANTEEN_CLOSED: 'CANTEEN_CLOSED',
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  CART_EMPTY: 'CART_EMPTY',
  CART_MIXED_CANTEENS: 'CART_MIXED_CANTEENS',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  BELOW_MINIMUM_ORDER: 'BELOW_MINIMUM_ORDER',
  COUPON_INVALID: 'COUPON_INVALID',
  DELIVERY_ALREADY_CLAIMED: 'DELIVERY_ALREADY_CLAIMED',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_UNVERIFIED: 'PAYMENT_UNVERIFIED',
  NETWORK: 'NETWORK',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const USER_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: "You don't have access to this.",
  NOT_FOUND: "We couldn't find that.",
  INVALID_TRANSITION: 'This order has already moved on. Refresh to see the latest status.',
  CANTEEN_CLOSED: 'This canteen is closed right now.',
  ITEM_UNAVAILABLE: 'An item in your cart just went out of stock.',
  CART_EMPTY: 'Your cart is empty.',
  CART_MIXED_CANTEENS: 'You can only order from one canteen at a time.',
  INVALID_QUANTITY: 'That quantity is not allowed.',
  BELOW_MINIMUM_ORDER: "You haven't reached this canteen's minimum order yet.",
  COUPON_INVALID: "That coupon can't be used on this order.",
  DELIVERY_ALREADY_CLAIMED: 'Another partner picked up this delivery first.',
  DUPLICATE_REQUEST: 'That was already submitted.',
  PAYMENT_FAILED: 'Payment did not go through. You have not been charged.',
  PAYMENT_UNVERIFIED: "We're still confirming your payment. This usually takes a few seconds.",
  NETWORK: 'Network problem. Check your connection and try again.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
    this.details = details;
  }
}

/** Turn anything thrown (network error, Postgres error, string) into a presentable AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  // Postgres functions raise with `ERRCODE`-tagged messages of the form "CODE: detail".
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message: unknown }).message);
    const code = message.split(':')[0]?.trim();
    if (code && code in ERROR_CODES) {
      return new AppError(code as ErrorCode, { raw: message });
    }
    return new AppError(ERROR_CODES.UNKNOWN, { raw: message });
  }
  return new AppError(ERROR_CODES.UNKNOWN, { raw: String(err) });
}
