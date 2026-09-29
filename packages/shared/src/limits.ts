/**
 * How long each piece of free text may be, and what a picture link may look like.
 *
 * The database holds the same numbers as CHECK constraints (the security_hardening
 * migration), and that copy is the authoritative one: a client that skips the form still
 * cannot store a 200 KB name or a `javascript:` link. These exist so every form stops the
 * user at the same place the database would, with a counter instead of a failed save.
 * `supabase/test/limits.test.ts` fails if the two disagree.
 */
export const TEXT_LIMITS = {
  fullName: 80,
  phone: 20,
  block: 20,
  room: 20,
  deliveryNote: 300,
  /** A cancellation or rejection reason, and the status-history note it becomes. */
  reason: 300,
  ticketSubject: 120,
  ticketBody: 2000,
  ticketResolution: 2000,
  reviewComment: 1000,
  canteenName: 80,
  menuItemName: 80,
  hostelName: 80,
  description: 500,
  couponCode: 40,
  url: 2048,
} as const;

/**
 * A picture link a page may load: `https://`, no whitespace, within the length limit.
 *
 * Plain `http://` is refused because the web app is served over HTTPS and the browser
 * would block it as mixed content anyway; `data:`, `javascript:` and every other scheme
 * are refused because an image URL is written by one person and fetched by every
 * student's browser.
 */
export function isHttpsUrl(value: string): boolean {
  return value.length <= TEXT_LIMITS.url && /^https:\/\/[^\s/?#]+[^\s]*$/i.test(value);
}
