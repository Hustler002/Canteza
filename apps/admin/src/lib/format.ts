/**
 * Admin-side presentation helpers.
 *
 * `formatCampusDateTime` used to live here. It moved to `packages/shared/time.ts`
 * when the student's order history needed the same rule on the phone — the campus
 * timezone is applied in exactly one place, and this re-export keeps every import in
 * this app pointing where it always did.
 */
export { formatCampusDateTime } from '@canteza/shared';

/** A status as an admin should read it: the stored value, just not shouting. */
export function formatStatus(status: string): string {
  return status.replaceAll('_', ' ');
}

/**
 * How a status should look in a list someone is scanning.
 *
 * Without this every badge is the same orange, and an order that was cancelled reads
 * exactly like one that was delivered. Three tones is all the distinction that exists:
 * it ended well, it ended badly, or it is still moving.
 */
export function statusTone(status: string): 'ok' | 'bad' | '' {
  if (status === 'delivered') return 'ok';
  if (status === 'cancelled' || status === 'rejected') return 'bad';
  return '';
}

/**
 * A student's saved delivery address, as one line.
 *
 * `profile_default_address_complete` makes these three all-or-nothing in the schema, so
 * a half-filled address cannot exist -- but the columns are individually nullable and
 * the generated types say so, and this is a display helper, not a place to assert.
 *
 * It is a *default*, not the address of record: an order snapshots where it actually
 * went, so changing rooms next term never rewrites last month's deliveries.
 */
export function formatAddress(
  hostel: string | null | undefined,
  block: string | null | undefined,
  room: string | null | undefined,
): string {
  if (!hostel || !block || !room) return '—';
  return `${hostel} ${block}-${room}`;
}
