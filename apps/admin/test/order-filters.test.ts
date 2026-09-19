import { describe, expect, it } from 'vitest';
import {
  campusDayEnd,
  campusDayStart,
  hasFilters,
  parseOrderFilters,
  searchTerm,
} from '../src/lib/order-filters';

/**
 * The orders page reads its filters straight out of the URL, so this is where a
 * hostile value would arrive. The search term in particular is interpolated into a
 * PostgREST `or=(...)` expression rather than passed as a parameter.
 */

describe('parseOrderFilters', () => {
  it('keeps what an order code or a room number is made of', () => {
    expect(parseOrderFilters({ q: '#1042' }).q).toBe('#1042');
    expect(parseOrderFilters({ q: 'B-214' }).q).toBe('B-214');
  });

  it('strips the characters that would end the term and start a new condition', () => {
    // Without this, a search could append its own filter to the or() group.
    expect(parseOrderFilters({ q: '1042,status.eq.delivered' }).q).toBe('1042statuseqdelivered');
    expect(parseOrderFilters({ q: 'x),or=(id.not.is.null' }).q).toBe('xoridnotisnull');
    expect(parseOrderFilters({ q: '*' }).q).toBe('');
    expect(parseOrderFilters({ q: '%_\\' }).q).toBe('');
  });

  it('caps the term so a megabyte of URL cannot become a megabyte of query', () => {
    expect(parseOrderFilters({ q: 'a'.repeat(500) }).q).toHaveLength(40);
  });

  it('accepts only real statuses', () => {
    expect(parseOrderFilters({ status: 'delivered' }).status).toBe('delivered');
    expect(parseOrderFilters({ status: 'out_for_delivery' }).status).toBeNull();
    expect(parseOrderFilters({ status: '' }).status).toBeNull();
  });

  it('accepts only a uuid as a canteen', () => {
    const id = 'c0000000-0000-4000-8000-000000000001';
    expect(parseOrderFilters({ canteen: id }).canteenId).toBe(id);
    expect(parseOrderFilters({ canteen: 'main' }).canteenId).toBeNull();
  });

  it('accepts only yyyy-mm-dd dates', () => {
    expect(parseOrderFilters({ from: '2026-09-19' }).from).toBe('2026-09-19');
    expect(parseOrderFilters({ from: '19/09/2026' }).from).toBeNull();
  });

  it('takes the first value when a key is repeated', () => {
    expect(parseOrderFilters({ status: ['ready', 'delivered'] }).status).toBe('ready');
  });

  it('reads an empty URL as no filters at all', () => {
    const filters = parseOrderFilters({});
    expect(filters).toEqual({ q: '', status: null, canteenId: null, from: null, to: null });
    expect(hasFilters(filters)).toBe(false);
    expect(hasFilters({ ...filters, status: 'ready' })).toBe(true);
  });
});

describe('searchTerm', () => {
  it('searches the two columns an admin is given a value for', () => {
    expect(searchTerm('1042')).toBe('code.ilike.*1042*,room.ilike.*1042*');
  });

  it('is null when there is nothing to search', () => {
    expect(searchTerm('')).toBeNull();
  });
});

describe('campus day bounds', () => {
  it('cuts the day on campus time, not the server’s', () => {
    // A UTC database would otherwise start 19 September at 05:30 IST and file the
    // previous evening's orders under the wrong day.
    expect(campusDayStart('2026-09-19')).toBe('2026-09-19T00:00:00+05:30');
  });

  it('ends on the next day’s start, so the chosen day is included whole', () => {
    expect(campusDayEnd('2026-09-19')).toBe('2026-09-20T00:00:00+05:30');
  });

  it('rolls over months and years', () => {
    expect(campusDayEnd('2026-09-30')).toBe('2026-10-01T00:00:00+05:30');
    expect(campusDayEnd('2026-12-31')).toBe('2027-01-01T00:00:00+05:30');
  });

  it('handles a leap day', () => {
    expect(campusDayEnd('2028-02-28')).toBe('2028-02-29T00:00:00+05:30');
  });

  it('puts a small-hours order on the campus day, not the UTC one', () => {
    // 19:00Z on the 19th is 00:30 IST on the 20th: campus day 20, UTC day 19 -- the one
    // window where the two disagree, and the reason the offset exists. Verified against
    // the live project by backdating a real order into it; this pins the semantics
    // rather than the string, so a naive UTC midnight fails here instead of in PostgREST.
    const smallHours = new Date('2026-09-19T19:00:00Z');
    expect(new Date(campusDayEnd('2026-09-19')).getTime()).toBeLessThanOrEqual(
      smallHours.getTime(),
    );
    expect(new Date(campusDayStart('2026-09-20')).getTime()).toBeLessThanOrEqual(
      smallHours.getTime(),
    );
    expect(new Date(campusDayEnd('2026-09-20')).getTime()).toBeGreaterThan(smallHours.getTime());
  });
});

describe('campus day arithmetic', () => {
  it('reads today from the campus clock, not the server’s', async () => {
    const { campusToday } = await import('../src/lib/order-filters');
    // 19:00 UTC on the 19th is 00:30 IST on the 20th. A server running UTC would call
    // this the 19th and file a late-night order under the wrong day.
    expect(campusToday(new Date('2026-09-19T19:00:00Z'))).toBe('2026-09-20');
    expect(campusToday(new Date('2026-09-19T15:02:00Z'))).toBe('2026-09-19');
  });

  it('shifts whole days across month and year ends', async () => {
    const { shiftDays } = await import('../src/lib/order-filters');
    expect(shiftDays('2026-09-19', -30)).toBe('2026-08-20');
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDays('2026-09-19', 0)).toBe('2026-09-19');
  });
});
