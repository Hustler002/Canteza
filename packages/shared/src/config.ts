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

  /**
   * The walk from a counter to a hostel room. A constant because campus is small and
   * every leg is comparable -- there is no traffic to model and no distance matrix to
   * buy. If the platform ever serves a campus where that stops being true, this is
   * where it becomes per-hostel.
   */
  deliveryMinutes: 10,
  /**
   * What to quote before a canteen has cooked enough orders to have a median of its
   * own, and the floor under any quote. A new canteen showing no ETA at all reads as
   * broken; one quoting two minutes reads as a lie.
   */
  defaultPrepMinutes: 15,
  /**
   * Below this many timed orders, `canteen_stats.median_prep_minutes` is ignored in
   * favour of the default. A median of three orders is an anecdote.
   */
  minPrepSampleSize: 5,
} as const;

/**
 * Door-to-door minutes to quote for a canteen: how long the kitchen actually takes,
 * plus the walk.
 *
 * The median comes from `canteen_stats`, which measures accepted -> ready over the
 * last 30 days, so a canteen that speeds up is quoted faster without anyone editing a
 * setting. Too few samples, or none, falls back to the platform default rather than
 * quoting a number built from two orders.
 *
 * Rounded up to the nearest five, because "about 25 minutes" is how anyone says this
 * out loud and a quote of 23 implies a precision that no kitchen has.
 */
export function estimatedMinutes(
  medianPrepMinutes: number | null | undefined,
  sampleSize: number | null | undefined,
): number {
  const trusted =
    typeof medianPrepMinutes === 'number' &&
    medianPrepMinutes > 0 &&
    (sampleSize ?? 0) >= PLATFORM_DEFAULTS.minPrepSampleSize;

  const prep = trusted ? medianPrepMinutes : PLATFORM_DEFAULTS.defaultPrepMinutes;
  const total = prep + PLATFORM_DEFAULTS.deliveryMinutes;

  return Math.ceil(total / 5) * 5;
}

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
