import { BRAND } from './brand';
import { CAMPUS_TIMEZONE } from './config';

/**
 * Dates, rendered on campus time.
 *
 * The admin app runs on a server whose clock is UTC, so leaving the timezone out
 * would print "19 Sep, 3:00 am" for an order placed at 8:30 in the evening. A phone
 * is usually already on campus time, but "usually" is not a thing to render a receipt
 * on — a student travelling home should still read the hour the food arrived.
 *
 * The formatters are built once at module scope because `Intl.DateTimeFormat` is
 * expensive enough that a list of 100 rows notices.
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

const date = new Intl.DateTimeFormat(BRAND.locale, {
  timeZone: CAMPUS_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/** The campus day something happened on, with no time of day. */
export function formatCampusDate(iso: string): string {
  return date.format(new Date(iso));
}
