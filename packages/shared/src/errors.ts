import { CAMPUS_EMAIL_DOMAIN } from './campus-email';

/**
 * Every failure the user can hit has a stable code, a safe user-facing message,
 * and optional technical details that stay out of the UI.
 */
export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  EMAIL_NOT_CONFIRMED: 'EMAIL_NOT_CONFIRMED',
  RATE_LIMITED: 'RATE_LIMITED',
  CAPTCHA_FAILED: 'CAPTCHA_FAILED',
  EMAIL_NOT_ALLOWED: 'EMAIL_NOT_ALLOWED',
  CODE_INVALID: 'CODE_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
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
  ALREADY_DELIVERY_PARTNER: 'ALREADY_DELIVERY_PARTNER',
  ALREADY_CANTEEN_STAFF: 'ALREADY_CANTEEN_STAFF',
  OFF_SHIFT: 'OFF_SHIFT',
  TOO_MANY_OPEN_ORDERS: 'TOO_MANY_OPEN_ORDERS',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_UNVERIFIED: 'PAYMENT_UNVERIFIED',
  PAYMENT_UNAVAILABLE: 'PAYMENT_UNAVAILABLE',
  NETWORK: 'NETWORK',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const USER_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Please sign in to continue.',
  // Deliberately does not say which of the two was wrong -- that tells an attacker
  // whether an email is registered.
  INVALID_CREDENTIALS: 'That email and password do not match.',
  EMAIL_IN_USE: 'An account with that email already exists. Try signing in.',
  WEAK_PASSWORD: 'Use at least 8 characters, with a letter and a number.',
  EMAIL_NOT_CONFIRMED: 'Check your email and confirm your address first.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  CAPTCHA_FAILED: 'The security check did not go through. Wait for it to finish, then try again.',
  EMAIL_NOT_ALLOWED: `Sign up with your college email, ending @${CAMPUS_EMAIL_DOMAIN} (no "+" in it).`,
  CODE_INVALID: 'That code is wrong or has expired. Check the latest email, or send a new code.',
  FORBIDDEN: "You don't have access to this.",
  ACCOUNT_SUSPENDED:
    'This account has been suspended. Contact support if you think this is a mistake.',
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
  ALREADY_DELIVERY_PARTNER:
    'That person still has a delivery posting. End it before making them canteen staff.',
  ALREADY_CANTEEN_STAFF:
    'That person works a counter. Detach them from it before putting them on deliveries.',
  OFF_SHIFT: 'Go online to take deliveries.',
  TOO_MANY_OPEN_ORDERS:
    'You already have several orders on the way. Wait for one to arrive before placing another.',
  DUPLICATE_REQUEST: 'That was already submitted.',
  PAYMENT_FAILED: 'Payment did not go through. You have not been charged.',
  PAYMENT_UNVERIFIED: "We're still confirming your payment. This usually takes a few seconds.",
  PAYMENT_UNAVAILABLE:
    "Online payment isn't available right now. Try again, or pay cash on delivery.",
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
