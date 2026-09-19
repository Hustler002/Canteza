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

/**
 * One campus, one timezone. Mirrors `campus_now()` in the schema, which states it in
 * SQL for the same reason: a server's own clock is UTC on Supabase and on Vercel, so
 * anything that means "today on campus" has to say so.
 *
 * The offset is written out because India has no daylight saving, which makes a fixed
 * `+05:30` exact forever and saves asking Intl for a zone at runtime. If the platform
 * ever serves a campus that does observe DST, this pair has to become a real lookup.
 */
export const CAMPUS_TIMEZONE = 'Asia/Kolkata';
export const CAMPUS_UTC_OFFSET = '+05:30';
