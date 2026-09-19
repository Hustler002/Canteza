import { CAMPUS_UTC_OFFSET, ORDER_STATUSES, type OrderStatus } from '@canteza/shared';

/**
 * Turns the orders page's URL into something safe to hand PostgREST.
 *
 * The filters live in `searchParams` rather than component state so a filtered view
 * is a link an admin can send to someone, and so the page stays a server component.
 * Everything here is pure, which is why it is the part with a test.
 */

export type OrderFilters = {
  /** Already stripped of anything that is not a code or a room number. */
  q: string;
  status: OrderStatus | null;
  canteenId: string | null;
  /** `yyyy-mm-dd`, or null. Interpreted on campus time, not the server's. */
  from: string | null;
  to: string | null;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A search term goes into a PostgREST `or=(...)` expression, where a comma starts the
 * next condition, a parenthesis closes the group, and `*` is the ilike wildcard. So the
 * term is reduced to the characters an order code or a room number is actually made of
 * instead of being escaped — there is nothing to express here that this forbids.
 */
const NOT_SEARCHABLE = /[^a-z0-9#-]/gi;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function parseOrderFilters(params: SearchParams): OrderFilters {
  const status = first(params.status);
  const canteenId = first(params.canteen);
  const from = first(params.from);
  const to = first(params.to);

  return {
    q: first(params.q).replace(NOT_SEARCHABLE, '').slice(0, 40),
    status: (ORDER_STATUSES as readonly string[]).includes(status) ? (status as OrderStatus) : null,
    canteenId: UUID.test(canteenId) ? canteenId : null,
    from: DATE.test(from) ? from : null,
    to: DATE.test(to) ? to : null,
  };
}

/** The `or=(...)` term for a search, or null when there is nothing to search for. */
export function searchTerm(q: string): string | null {
  if (!q) return null;
  return `code.ilike.*${q}*,room.ilike.*${q}*`;
}

/**
 * The instant a campus day starts, as PostgREST should compare it.
 *
 * `created_at` is a timestamptz and the database runs on UTC, so a bare `2026-09-19`
 * would cut the day at 05:30 IST and put an evening order on the wrong date.
 */
export function campusDayStart(date: string): string {
  return `${date}T00:00:00${CAMPUS_UTC_OFFSET}`;
}

/**
 * The instant the campus day *after* `date` starts, so a `to` bound can be exclusive
 * and still include everything that happened on the day the admin picked.
 */
export function campusDayEnd(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return campusDayStart(next.toISOString().slice(0, 10));
}

/** True when any filter is set — lets the page offer a "clear" link only when it helps. */
export function hasFilters(filters: OrderFilters): boolean {
  return Boolean(filters.q || filters.status || filters.canteenId || filters.from || filters.to);
}
