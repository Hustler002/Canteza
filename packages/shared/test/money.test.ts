import { describe, expect, it } from 'vitest';
import { parsePriceRupees } from '../src/money';

/**
 * The price rule, which both the admin form and the counter's screen ask of whatever
 * someone typed. `menu_items.price_paise > 0` is a check constraint, so anything this
 * lets through has to survive the database.
 */
describe('parsePriceRupees', () => {
  it('converts rupees to integer paise', () => {
    expect(parsePriceRupees('80')).toBe(8000);
    expect(parsePriceRupees(' 12.5 ')).toBe(1250);
  });

  it('rounds rather than letting a float reach the money column', () => {
    const paise = parsePriceRupees('79.995');
    expect(paise).toBe(8000);
    expect(Number.isInteger(paise)).toBe(true);
  });

  it('refuses anything the check constraint would', () => {
    expect(parsePriceRupees('0')).toBeNull();
    expect(parsePriceRupees('-20')).toBeNull();
    // The one worth having a test for: positive in rupees, zero after rounding.
    expect(parsePriceRupees('0.004')).toBeNull();
  });

  it('refuses what is not a number at all, including empty', () => {
    expect(parsePriceRupees('')).toBeNull();
    expect(parsePriceRupees('free')).toBeNull();
    expect(parsePriceRupees('12rs')).toBeNull();
  });
});
