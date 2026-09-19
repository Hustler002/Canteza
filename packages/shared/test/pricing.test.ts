import { describe, expect, it } from 'vitest';
import {
  computeTotals,
  couponDiscount,
  subtotal,
  type CartLine,
  type Coupon,
} from '../src/pricing';
import { formatPaise, rupeesToPaise } from '../src/money';
import { AppError } from '../src/errors';

const lines: CartLine[] = [
  { itemId: 'maggi', unitPricePaise: 4000, quantity: 2 },
  { itemId: 'coffee', unitPricePaise: 6000, quantity: 1 },
];

describe('pricing', () => {
  it('sums line totals in paise', () => {
    expect(subtotal(lines)).toBe(14000);
  });

  it('adds fees on top of the discounted subtotal', () => {
    const totals = computeTotals({ lines, deliveryFeePaise: 1000, packagingFeePaise: 500 });
    expect(totals).toEqual({
      subtotalPaise: 14000,
      discountPaise: 0,
      deliveryFeePaise: 1000,
      packagingFeePaise: 500,
      totalPaise: 15500,
    });
  });

  it('caps a percent coupon at its maximum discount', () => {
    const coupon: Coupon = {
      code: 'CAMPUS50',
      kind: 'percent',
      percentOff: 50,
      maxDiscountPaise: 3000,
      minOrderPaise: 0,
    };
    expect(couponDiscount(coupon, 14000)).toBe(3000);
  });

  it('never discounts more than the subtotal, so the total can never go negative', () => {
    const coupon: Coupon = { code: 'HUGE', kind: 'flat', amountPaise: 99_000, minOrderPaise: 0 };
    const totals = computeTotals({ lines, deliveryFeePaise: 1000, coupon });
    expect(totals.discountPaise).toBe(14000);
    expect(totals.totalPaise).toBe(1000);
  });

  it('rejects a coupon below its minimum order', () => {
    const coupon: Coupon = { code: 'BIG', kind: 'flat', amountPaise: 5000, minOrderPaise: 20000 };
    expect(() => couponDiscount(coupon, 14000)).toThrow(AppError);
  });

  it('rejects fractional paise, which would desynchronise client and server totals', () => {
    const bad: CartLine[] = [{ itemId: 'x', unitPricePaise: 40.5, quantity: 1 }];
    expect(() => subtotal(bad)).toThrow(RangeError);
  });

  it('round-trips rupees through paise without float drift', () => {
    expect(rupeesToPaise(140.1) + rupeesToPaise(0.2)).toBe(rupeesToPaise(140.3));
  });

  it('formats Indian currency and drops empty decimals', () => {
    expect(formatPaise(14000)).toBe('₹140');
    expect(formatPaise(14050)).toBe('₹140.50');
  });
});
