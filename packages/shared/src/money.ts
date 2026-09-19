import { BRAND } from './brand';

/**
 * All money in this system is an integer number of paise.
 * Never use floats for money: 0.1 + 0.2 !== 0.3 and order totals must reconcile exactly.
 */
export type Paise = number;

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

/**
 * A price someone typed in rupees, as paise — or null if the database would refuse it.
 *
 * `menu_items.price_paise > 0` is a check constraint, and the test has to happen
 * *after* the conversion: 0.004 is a positive number of rupees that rounds to zero
 * paise, so a naive check on the typed value passes something the column rejects.
 * Shared because both the admin form and the counter's screen ask the same question.
 */
export function parsePriceRupees(text: string): Paise | null {
  const rupees = Number(text.trim());
  if (!Number.isFinite(rupees)) return null;
  const paise = rupeesToPaise(rupees);
  return paise > 0 ? paise : null;
}

const formatter = new Intl.NumberFormat(BRAND.locale, {
  style: 'currency',
  currency: BRAND.currency,
  maximumFractionDigits: 2,
});

/** "₹140" / "₹140.50" — trailing ".00" is dropped because campus prices are usually whole rupees. */
export function formatPaise(paise: Paise): string {
  const formatted = formatter.format(paiseToRupees(paise));
  return formatted.replace(/\.00$/, '');
}

export function assertValidPaise(value: number, label = 'amount'): asserts value is Paise {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer of paise, got ${value}`);
  }
}
