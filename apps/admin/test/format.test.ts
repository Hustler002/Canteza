import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES } from '@canteza/shared';
import { formatAddress, formatCampusDateTime, formatStatus, statusTone } from '../src/lib/format';

describe('formatCampusDateTime', () => {
  it('renders an instant on campus time, not the server’s', () => {
    // 20:32 IST on 19 September, stored as the UTC instant PostgREST returns. A server
    // running UTC would otherwise print this as 15:02 on the same day.
    expect(formatCampusDateTime('2026-09-19T15:02:00+00:00')).toContain('19 Sep');
    expect(formatCampusDateTime('2026-09-19T15:02:00+00:00')).toContain('08:32');
  });

  it('keeps an evening order on the day it was placed', () => {
    // 00:30 IST on the 20th is 19:00 UTC on the 19th — the case a naive format gets wrong.
    expect(formatCampusDateTime('2026-09-19T19:00:00+00:00')).toContain('20 Sep');
  });
});

describe('statusTone', () => {
  it('tells the two kinds of ending apart', () => {
    expect(statusTone('delivered')).toBe('ok');
    expect(statusTone('cancelled')).toBe('bad');
    expect(statusTone('rejected')).toBe('bad');
  });

  it('leaves anything still moving on the default tone', () => {
    expect(statusTone('pending')).toBe('');
    expect(statusTone('picked_up')).toBe('');
  });

  it('has an answer for every status in the state machine', () => {
    for (const status of ORDER_STATUSES) {
      expect(['ok', 'bad', '']).toContain(statusTone(status));
    }
  });
});

describe('formatStatus', () => {
  it('unshouts the stored value without inventing a label', () => {
    expect(formatStatus('picked_up')).toBe('picked up');
    expect(formatStatus('ready')).toBe('ready');
  });
});

describe('formatAddress', () => {
  it('renders a saved default as one line', () => {
    expect(formatAddress('Aryabhatta Hostel', 'A', '214')).toBe('Aryabhatta Hostel A-214');
  });

  it('shows a dash when the student has saved none', () => {
    // profile_default_address_complete makes these all-or-nothing, but the columns are
    // each nullable and a display helper is not the place to assert a constraint.
    expect(formatAddress(null, null, null)).toBe('—');
    expect(formatAddress(undefined, undefined, undefined)).toBe('—');
  });

  it('does not render a half address, whichever part is missing', () => {
    expect(formatAddress('Aryabhatta Hostel', null, '214')).toBe('—');
    expect(formatAddress('Aryabhatta Hostel', 'A', null)).toBe('—');
    expect(formatAddress(null, 'A', '214')).toBe('—');
  });
});
