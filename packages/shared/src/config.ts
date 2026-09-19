/**
 * Platform defaults. Anything a non-engineer might want to change later lives in the
 * `platform_settings` table; these are the fallbacks used when a setting is absent.
 */
export const PLATFORM_DEFAULTS = {
  deliveryFeePaise: 1000, // ₹10
  packagingFeePaise: 0,
  minOrderPaise: 0,
  maxQuantityPerItem: 20,
  maxItemsPerOrder: 50,
  /**
   * Our only revenue: a slice of the delivery fee. The canteen keeps 100% of the
   * food subtotal and the rest of the delivery fee (₹8), out of which it pays its
   * own delivery staff. Deliberately small — canteens need to profit first.
   */
  platformFeePaise: 200, // ₹2 of the ₹10 delivery fee
} as const;
