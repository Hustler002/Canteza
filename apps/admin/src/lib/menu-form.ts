import { parsePriceRupees } from '@canteza/shared';

/**
 * The menu item form, turned into a `menu_items` row.
 *
 * Pure and separate from the action, the same shape as `canteen-form.ts`, so the rules
 * are testable without a database or Next's request context. The database still has the
 * last word on every one of them — `price_paise > 0` is a check constraint and
 * `(canteen_id, name)` is unique — this is the pre-submit copy (rule 2).
 */

export type MenuFormValues = {
  name: string;
  description: string;
  pricePaise: number;
  /** Null is uncategorised, which the column allows and `on delete set null` produces. */
  categoryId: string | null;
  imageUrl: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  sortOrder: number;
};

export type ParseResult = { ok: true; values: MenuFormValues } | { ok: false; error: string };

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** An empty optional field means "clear it", not "the empty string". */
function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function parseMenuForm(form: FormData): ParseResult {
  const name = text(form, 'name');
  if (!name) return { ok: false, error: 'An item needs a name.' };
  if (name.length > 80) return { ok: false, error: 'That name is too long.' };

  const rupees = text(form, 'price_rupees');
  if (rupees === '') return { ok: false, error: 'An item needs a price.' };
  // Rupees in, paise out, and the `price_paise > 0` rule applied after the rounding.
  // The rule lives in `money.ts` because the counter's screen asks the same question
  // of a text input rather than a FormData (rule 1, rule 2).
  const pricePaise = parsePriceRupees(rupees);
  if (pricePaise === null) {
    return { ok: false, error: 'A price must be more than zero.' };
  }

  const order = text(form, 'sort_order');
  const sortOrder = order === '' ? 0 : Number(order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { ok: false, error: 'Sort order must be a whole number, zero or more.' };
  }

  return {
    ok: true,
    values: {
      name,
      description: text(form, 'description'),
      pricePaise,
      categoryId: optional(form, 'category_id'),
      imageUrl: optional(form, 'image_url'),
      isVeg: form.get('is_veg') !== null,
      // An unchecked checkbox is absent from FormData entirely, so both of these read
      // as false on a form that never rendered them.
      isAvailable: form.get('is_available') !== null,
      sortOrder,
    },
  };
}

/** The row `menu_items` takes. Separate from the values so the action stays a one-liner. */
export function menuItemRow(values: MenuFormValues) {
  return {
    name: values.name,
    description: values.description,
    price_paise: values.pricePaise,
    category_id: values.categoryId,
    image_url: values.imageUrl,
    is_veg: values.isVeg,
    is_available: values.isAvailable,
    sort_order: values.sortOrder,
  };
}
