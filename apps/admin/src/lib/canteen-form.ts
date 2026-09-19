import { rupeesToPaise } from '@canteza/shared';

/**
 * The canteen edit form, turned into the arguments `admin_update_canteen` takes.
 *
 * Kept pure and separate from the action so the rules are testable without a database
 * and without Next's request context. The database has the last word on every one of
 * these — this is the pre-submit copy (rule 2).
 */

export type CanteenFormValues = {
  name: string;
  description: string;
  /** Null clears the column; the RPC assigns rather than coalesces. */
  phone: string | null;
  imageUrl: string | null;
  minOrderPaise: number;
  opensAt: string;
  closesAt: string;
  isAcceptingOrders: boolean;
};

export type ParseResult = { ok: true; values: CanteenFormValues } | { ok: false; error: string };

/** `<input type="time">` hands back HH:MM; Postgres `time` takes that as-is. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** An empty optional field means "clear it", not "the empty string". */
function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function parseCanteenForm(form: FormData): ParseResult {
  const name = text(form, 'name');
  if (!name) return { ok: false, error: 'A canteen needs a name.' };
  if (name.length > 80) return { ok: false, error: 'That name is too long.' };

  const opensAt = text(form, 'opens_at');
  const closesAt = text(form, 'closes_at');
  if (!TIME.test(opensAt) || !TIME.test(closesAt)) {
    return { ok: false, error: 'Opening and closing times must both be set.' };
  }

  // Equal times mean 24 hours in `is_within_hours`, and a window that crosses midnight
  // is normal on this campus (Night Canteen runs 20:00 to 02:00) — so there is no
  // "closes before it opens" case to reject here. Only a malformed time is wrong.

  const rupees = text(form, 'min_order_rupees');
  const parsed = rupees === '' ? 0 : Number(rupees);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: 'Minimum order must be zero or more.' };
  }
  // Typed in rupees, stored in paise — the conversion happens once, here.
  const minOrderPaise = rupeesToPaise(parsed);

  return {
    ok: true,
    values: {
      name,
      description: text(form, 'description'),
      phone: optional(form, 'phone'),
      imageUrl: optional(form, 'image_url'),
      minOrderPaise,
      opensAt,
      closesAt,
      // An unchecked checkbox is absent from FormData entirely.
      isAcceptingOrders: form.get('is_accepting_orders') !== null,
    },
  };
}

/** "08:00–22:00", or "Open 24 hours" when the window has no edges. */
export function formatHours(opensAt: string, closesAt: string): string {
  const open = opensAt.slice(0, 5);
  const close = closesAt.slice(0, 5);
  return open === close ? 'Open 24 hours' : `${open}–${close}`;
}
