'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toAppError } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { menuItemRow, parseMenuForm } from '@/lib/menu-form';

/**
 * The menu.
 *
 * Plain table writes rather than RPCs, for the same reason as `hostels/actions.ts`:
 * `menu_items` has carried a client grant and two WITH CHECK policies since Phase 2 —
 * `menu_items_admin` and `menu_items_own_canteen` — and no column here needs
 * withholding, because a price is exactly what the counter is supposed to write. A
 * `security definer` function would restate the policy in a second place and add a
 * migration to keep in step with it. What was missing was never the authorisation; it
 * was any code at all that wrote the table.
 *
 * RLS still decides: this file runs as the signed-in admin, so the same page served to
 * a canteen account would be scoped to that canteen's own items by policy, not by the
 * `canteenId` argument below.
 */

/** Postgres's unique_violation — `(canteen_id, name)` is unique per canteen. */
const UNIQUE_VIOLATION = '23505';

function messageFor(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    if ((error as { code: unknown }).code === UNIQUE_VIOLATION) {
      return 'This canteen already has an item with that name.';
    }
  }
  return toAppError(error).userMessage;
}

function menuPath(canteenId: string): string {
  return `/canteens/${canteenId}/menu`;
}

export async function createMenuItem(canteenId: string, formData: FormData): Promise<void> {
  const parsed = parseMenuForm(formData);
  if (!parsed.ok) {
    redirect(`${menuPath(canteenId)}?error=${encodeURIComponent(parsed.error)}`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('menu_items')
    .insert({ ...menuItemRow(parsed.values), canteen_id: canteenId });

  if (error) {
    redirect(`${menuPath(canteenId)}?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath(menuPath(canteenId));
  redirect(`${menuPath(canteenId)}?saved=${encodeURIComponent(parsed.values.name)}`);
}

export async function updateMenuItem(
  canteenId: string,
  itemId: string,
  formData: FormData,
): Promise<void> {
  const parsed = parseMenuForm(formData);
  if (!parsed.ok) {
    redirect(`${menuPath(canteenId)}?error=${encodeURIComponent(parsed.error)}`);
  }

  const supabase = await createServerSupabase();
  // `canteen_id` is in the filter as well as the policy: it costs nothing and means a
  // mismatched pair of ids in a URL updates zero rows rather than one somewhere else.
  const { error } = await supabase
    .from('menu_items')
    .update(menuItemRow(parsed.values))
    .eq('id', itemId)
    .eq('canteen_id', canteenId);

  if (error) {
    redirect(`${menuPath(canteenId)}?error=${encodeURIComponent(messageFor(error))}`);
  }

  // A price change never rewrites a receipt: `order_items` snapshotted the name and
  // unit price at purchase (rule 6), so past orders read exactly as they were charged.
  revalidatePath(menuPath(canteenId));
  redirect(`${menuPath(canteenId)}?saved=${encodeURIComponent(parsed.values.name)}`);
}

/**
 * Retire an item, or bring it back.
 *
 * Not a delete, and not merely a preference: `order_items.menu_item_id` references this
 * table with no `on delete` clause, so Postgres refuses to remove anything anyone has
 * ever ordered. The FK is kept deliberately — reorder and analytics join to it while the
 * snapshot supplies the historical price — so retiring is the only retirement path there
 * is. `listMenu` filters on `is_active`, so the item leaves every student's menu.
 */
export async function setMenuItemActive(
  canteenId: string,
  itemId: string,
  active: boolean,
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('menu_items')
    .update({ is_active: active })
    .eq('id', itemId)
    .eq('canteen_id', canteenId);

  if (error) {
    redirect(`${menuPath(canteenId)}?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath(menuPath(canteenId));
  redirect(menuPath(canteenId));
}
