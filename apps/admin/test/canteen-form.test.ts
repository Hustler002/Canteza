import { describe, expect, it } from 'vitest';
import { formatHours, parseCanteenForm } from '../src/lib/canteen-form';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const valid = {
  name: 'Main Canteen',
  description: 'The big one.',
  opens_at: '08:00',
  closes_at: '22:00',
  min_order_rupees: '50',
};

describe('parseCanteenForm', () => {
  it('converts the rupees an admin types into the paise the column stores', () => {
    const result = parseCanteenForm(form(valid));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.minOrderPaise).toBe(5000);
  });

  it('rounds rather than letting a float reach the money column', () => {
    const result = parseCanteenForm(form({ ...valid, min_order_rupees: '49.995' }));
    if (!result.ok) throw new Error(result.error);
    expect(Number.isInteger(result.values.minOrderPaise)).toBe(true);
    expect(result.values.minOrderPaise).toBe(5000);
  });

  it('treats a blank minimum as zero, not as NaN', () => {
    const result = parseCanteenForm(form({ ...valid, min_order_rupees: '' }));
    if (!result.ok) throw new Error(result.error);
    expect(result.values.minOrderPaise).toBe(0);
  });

  it('refuses a negative or unparseable minimum', () => {
    expect(parseCanteenForm(form({ ...valid, min_order_rupees: '-5' })).ok).toBe(false);
    expect(parseCanteenForm(form({ ...valid, min_order_rupees: 'free' })).ok).toBe(false);
  });

  it('refuses a missing name', () => {
    expect(parseCanteenForm(form({ ...valid, name: '   ' })).ok).toBe(false);
  });

  it('refuses a malformed time', () => {
    expect(parseCanteenForm(form({ ...valid, opens_at: '25:00' })).ok).toBe(false);
    expect(parseCanteenForm(form({ ...valid, closes_at: '8am' })).ok).toBe(false);
    expect(parseCanteenForm(form({ ...valid, closes_at: '' })).ok).toBe(false);
  });

  it('accepts a window that crosses midnight, because Night Canteen is one', () => {
    const result = parseCanteenForm(form({ ...valid, opens_at: '20:00', closes_at: '02:00' }));
    expect(result.ok).toBe(true);
  });

  it('accepts equal times, which the schema reads as open around the clock', () => {
    const result = parseCanteenForm(form({ ...valid, opens_at: '00:00', closes_at: '00:00' }));
    expect(result.ok).toBe(true);
  });

  it('turns an emptied optional field into null, so the RPC clears the column', () => {
    const result = parseCanteenForm(form({ ...valid, phone: '', image_url: '' }));
    if (!result.ok) throw new Error(result.error);
    expect(result.values.phone).toBeNull();
    expect(result.values.imageUrl).toBeNull();
  });

  it('reads an absent checkbox as paused, since a form omits unchecked boxes', () => {
    const off = parseCanteenForm(form(valid));
    if (!off.ok) throw new Error(off.error);
    expect(off.values.isAcceptingOrders).toBe(false);

    const on = parseCanteenForm(form({ ...valid, is_accepting_orders: 'on' }));
    if (!on.ok) throw new Error(on.error);
    expect(on.values.isAcceptingOrders).toBe(true);
  });
});

describe('formatHours', () => {
  it('trims the seconds Postgres returns on a time column', () => {
    expect(formatHours('08:00:00', '22:00:00')).toBe('08:00–22:00');
  });

  it('names the all-day case rather than printing 00:00–00:00', () => {
    expect(formatHours('00:00:00', '00:00:00')).toBe('Open 24 hours');
  });
});
