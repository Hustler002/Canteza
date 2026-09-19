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
  /** Partner's cut of the delivery fee; the rest is platform margin. */
  partnerPayoutPaise: 800, // ₹8
} as const;
