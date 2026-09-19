import { BRAND, CAMPUS_TIMEZONE } from '@canteza/shared';

/**
 * Dates, rendered on campus time.
 *
 * This app runs on a server whose clock is UTC, so leaving the timezone out would
 * print "19 Sep, 3:00 am" for an order placed at 8:30 in the evening. The formatters
 * are built once at module scope because `Intl.DateTimeFormat` is expensive enough
 * that a table of 100 rows notices.
 */

const dateTime = new Intl.DateTimeFormat(BRAND.locale, {
  timeZone: CAMPUS_TIMEZONE,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatCampusDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

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
