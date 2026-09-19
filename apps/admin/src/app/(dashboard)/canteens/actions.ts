'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toAppError } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { parseCanteenForm } from '@/lib/canteen-form';

/**
 * The admin's canteen writes.
 *
 * Both go through `security definer` RPCs rather than a table update, because the
 * column grant on `canteens` was narrowed to what canteen *staff* may write
 * (`opens_at`, `closes_at`, `is_accepting_orders`) and a Postgres grant is per role —
 * admins are `authenticated` like everyone else. See the canteen_column_grants
 * migration. The RPC re-checks `is_admin()` server-side, so this file being reachable
 * proves nothing and grants nothing.
 *
 * Outcomes travel back in the URL rather than through `useActionState`, which would
 * make these forms client components. It also keeps the slice consistent: the orders
 * page already puts its state in `searchParams`, and a failed save is then a link
 * someone can be sent.
 */

/** Postgres's unique_violation — the only constraint an admin can trip by typing. */
const UNIQUE_VIOLATION = '23505';

function messageFor(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    if ((error as { code: unknown }).code === UNIQUE_VIOLATION) {
      return 'Another canteen already has that name.';
    }
  }
  return toAppError(error).userMessage;
}

export async function updateCanteen(canteenId: string, formData: FormData): Promise<void> {
  const parsed = parseCanteenForm(formData);
  if (!parsed.ok) {
    redirect(`/canteens/${canteenId}?error=${encodeURIComponent(parsed.error)}`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_update_canteen', {
    p_canteen_id: canteenId,
    p_name: parsed.values.name,
    p_description: parsed.values.description,
    p_phone: parsed.values.phone,
    p_image_url: parsed.values.imageUrl,
    p_min_order_paise: parsed.values.minOrderPaise,
    p_opens_at: parsed.values.opensAt,
    p_closes_at: parsed.values.closesAt,
    p_is_accepting_orders: parsed.values.isAcceptingOrders,
  });

  if (error) {
    redirect(`/canteens/${canteenId}?error=${encodeURIComponent(messageFor(error))}`);
  }

  // The list shows the name and hours, and the orders page lists canteens in its filter.
  revalidatePath('/canteens');
  revalidatePath(`/canteens/${canteenId}`);
  redirect(`/canteens?saved=${encodeURIComponent(parsed.values.name)}`);
}

export async function setCanteenActive(canteenId: string, active: boolean): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_set_canteen_active', {
    p_canteen_id: canteenId,
    p_active: active,
  });

  if (error) {
    redirect(`/canteens?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath('/canteens');
  redirect('/canteens');
}
