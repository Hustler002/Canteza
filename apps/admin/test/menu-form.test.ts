import { describe, expect, it } from 'vitest';
import { menuItemRow, parseMenuForm } from '../src/lib/menu-form';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const valid = {
  name: 'Veg Thali',
  description: 'Rice, dal, two sabzi.',
  price_rupees: '80',
  sort_order: '10',
};

describe('parseMenuForm', () => {
  it('converts the rupees an admin types into the paise the column stores', () => {
    const result = parseMenuForm(form(valid));
    if (!result.ok) throw new Error(result.error);
    expect(result.values.pricePaise).toBe(8000);
    expect(Number.isInteger(result.values.pricePaise)).toBe(true);
  });

  it('rounds rather than letting a float reach the money column', () => {
    const result = parseMenuForm(form({ ...valid, price_rupees: '79.995' }));
    if (!result.ok) throw new Error(result.error);
    expect(result.values.pricePaise).toBe(8000);
  });

  it('refuses a free item, because price_paise > 0 is a check constraint', () => {
    expect(parseMenuForm(form({ ...valid, price_rupees: '0' })).ok).toBe(false);
    expect(parseMenuForm(form({ ...valid, price_rupees: '-20' })).ok).toBe(false);
  });

  it('refuses a price that is positive in rupees but zero in paise', () => {
    // The interesting one: 0.004 passes a naive `> 0` on the typed value and then
    // rounds to nothing, which the database would reject after a round trip.
    expect(parseMenuForm(form({ ...valid, price_rupees: '0.004' })).ok).toBe(false);
  });

  it('refuses a missing or unparseable price rather than defaulting it', () => {
    expect(parseMenuForm(form({ ...valid, price_rupees: '' })).ok).toBe(false);
    expect(parseMenuForm(form({ ...valid, price_rupees: 'free' })).ok).toBe(false);
  });

  it('needs a name, and caps it at the length the column is given', () => {
    expect(parseMenuForm(form({ ...valid, name: '   ' })).ok).toBe(false);
    expect(parseMenuForm(form({ ...valid, name: 'x'.repeat(81) })).ok).toBe(false);
  });

  it('treats a blank sort order as zero and refuses a fractional one', () => {
    const blank = parseMenuForm(form({ ...valid, sort_order: '' }));
    if (!blank.ok) throw new Error(blank.error);
    expect(blank.values.sortOrder).toBe(0);
    expect(parseMenuForm(form({ ...valid, sort_order: '1.5' })).ok).toBe(false);
    expect(parseMenuForm(form({ ...valid, sort_order: '-1' })).ok).toBe(false);
  });

  it('reads an empty optional field as null, so saving clears the column', () => {
    const result = parseMenuForm(form({ ...valid, category_id: '', image_url: '' }));
    if (!result.ok) throw new Error(result.error);
    expect(result.values.categoryId).toBeNull();
    expect(result.values.imageUrl).toBeNull();
  });

  it('reads an absent checkbox as false — an unchecked box is not in FormData', () => {
    const off = parseMenuForm(form(valid));
    if (!off.ok) throw new Error(off.error);
    expect(off.values.isVeg).toBe(false);
    expect(off.values.isAvailable).toBe(false);

    const on = parseMenuForm(form({ ...valid, is_veg: 'on', is_available: 'on' }));
    if (!on.ok) throw new Error(on.error);
    expect(on.values.isVeg).toBe(true);
    expect(on.values.isAvailable).toBe(true);
  });
});

describe('menuItemRow', () => {
  it('names every column the table has, and never the canteen', () => {
    const parsed = parseMenuForm(form({ ...valid, is_veg: 'on', is_available: 'on' }));
    if (!parsed.ok) throw new Error(parsed.error);
    // `canteen_id` is supplied by the action from the route, never by the form: a
    // hidden field would let a crafted POST file an item under another counter.
    expect(menuItemRow(parsed.values)).toEqual({
      name: 'Veg Thali',
      description: 'Rice, dal, two sabzi.',
      price_paise: 8000,
      category_id: null,
      image_url: null,
      is_veg: true,
      is_available: true,
      sort_order: 10,
    });
  });
});
