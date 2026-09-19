import { AppError, ERROR_CODES } from './errors';
import { assertValidPaise, type Paise } from './money';

export type CartLine = {
  itemId: string;
  unitPricePaise: Paise;
  quantity: number;
};

export type Coupon =
  | { code: string; kind: 'flat'; amountPaise: Paise; minOrderPaise: Paise }
  | {
      code: string;
      kind: 'percent';
      percentOff: number;
      maxDiscountPaise: Paise;
      minOrderPaise: Paise;
    };

export type PricingInput = {
  lines: readonly CartLine[];
  deliveryFeePaise: Paise;
  packagingFeePaise?: Paise;
  coupon?: Coupon | undefined;
};

export type OrderTotals = {
  subtotalPaise: Paise;
  discountPaise: Paise;
  deliveryFeePaise: Paise;
  packagingFeePaise: Paise;
  totalPaise: Paise;
};

export function subtotal(lines: readonly CartLine[]): Paise {
  return lines.reduce((sum, line) => {
    assertValidPaise(line.unitPricePaise, 'unitPricePaise');
    return sum + line.unitPricePaise * line.quantity;
  }, 0);
}

/**
 * Discount is capped at the subtotal: a coupon never pays for delivery and never
 * produces a negative total (which would mean paying the student).
 */
/**
 * A coupon code as the database stores and matches it.
 *
 * `place_order` looks the code up with `upper(trim(code))`, so a student typing
 * " save20 " has to reach the same row. Normalising here rather than only in SQL is
 * what lets the checkout screen show the code it is actually about to send.
 */
export function normaliseCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export function couponDiscount(coupon: Coupon | undefined, subtotalPaise: Paise): Paise {
  if (!coupon) return 0;
  if (subtotalPaise < coupon.minOrderPaise) {
    throw new AppError(ERROR_CODES.COUPON_INVALID, {
      code: coupon.code,
      reason: 'below_minimum',
      minOrderPaise: coupon.minOrderPaise,
    });
  }
  const raw =
    coupon.kind === 'flat'
      ? coupon.amountPaise
      : Math.min(Math.round((subtotalPaise * coupon.percentOff) / 100), coupon.maxDiscountPaise);

  return Math.min(raw, subtotalPaise);
}

/**
 * The only place order money is computed. The server runs the same arithmetic in SQL
 * and stores the result; the client's copy exists purely to render the cart.
 */
export function computeTotals(input: PricingInput): OrderTotals {
  const subtotalPaise = subtotal(input.lines);
  const discountPaise = couponDiscount(input.coupon, subtotalPaise);
  const packagingFeePaise = input.packagingFeePaise ?? 0;
  const deliveryFeePaise = input.deliveryFeePaise;

  assertValidPaise(deliveryFeePaise, 'deliveryFeePaise');
  assertValidPaise(packagingFeePaise, 'packagingFeePaise');

  return {
    subtotalPaise,
    discountPaise,
    deliveryFeePaise,
    packagingFeePaise,
    totalPaise: subtotalPaise - discountPaise + deliveryFeePaise + packagingFeePaise,
  };
}
