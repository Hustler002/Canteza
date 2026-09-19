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

export async function createCanteen(formData: FormData): Promise<void> {
  const parsed = parseCanteenForm(formData);
  if (!parsed.ok) {
    redirect(`/canteens/new?error=${encodeURIComponent(parsed.error)}`);
  }

  const supabase = await createServerSupabase();
  // `is_accepting_orders` is not a parameter: the new canteen is created disabled, so
  // the pause switch has nothing to pause. It keeps its column default and becomes
  // meaningful the moment an admin enables the canteen.
  const { data: id, error } = await supabase.rpc('admin_create_canteen', {
    p_name: parsed.values.name,
    p_description: parsed.values.description,
    p_phone: parsed.values.phone,
    p_image_url: parsed.values.imageUrl,
    p_min_order_paise: parsed.values.minOrderPaise,
    p_opens_at: parsed.values.opensAt,
    p_closes_at: parsed.values.closesAt,
  });

  if (error || !id) {
    redirect(`/canteens/new?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath('/canteens');
  redirect(`/canteens?created=${encodeURIComponent(parsed.values.name)}`);
}

/**
 * Staff attachment.
 *
 * Both write two things at once — the `canteen_staff` row and `profiles.role` — which is
 * why they are RPCs and why `canteen_staff` no longer carries a client write grant. A
 * direct insert would give someone the canteen's data behind a student's menu.
 */
export async function attachStaff(canteenId: string, formData: FormData): Promise<void> {
  const profileId = formData.get('profile_id');
  if (typeof profileId !== 'string' || !profileId) {
    redirect(`/canteens/${canteenId}?error=${encodeURIComponent('Pick someone to attach.')}`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_attach_canteen_staff', {
    p_profile_id: profileId,
    p_canteen_id: canteenId,
  });

  if (error) {
    redirect(`/canteens/${canteenId}?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath(`/canteens/${canteenId}`);
  redirect(`/canteens/${canteenId}`);
}

export async function detachStaff(canteenId: string, profileId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_detach_canteen_staff', {
    p_profile_id: profileId,
    p_canteen_id: canteenId,
  });

  if (error) {
    redirect(`/canteens/${canteenId}?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath(`/canteens/${canteenId}`);
  redirect(`/canteens/${canteenId}`);
}

/**
 * Delivery staff.
 *
 * `delivery_partners` has no client INSERT or DELETE grant and only `is_online` is
 * writable — the partner's own shift toggle. Everything an admin does here is therefore
 * an RPC, and a retired posting is kept rather than deleted so historical orders still
 * resolve through the composite foreign key (ADR 008).
 */
export async function onboardPartner(canteenId: string, formData: FormData): Promise<void> {
  const profileId = formData.get('profile_id');
  if (typeof profileId !== 'string' || !profileId) {
    redirect(`/canteens/${canteenId}?error=${encodeURIComponent('Pick someone to onboard.')}`);
  }

  const supabase = await createServerSupabase();
  // Approved on onboarding: an admin putting someone on a roster *is* the vetting step.
  // `my_delivery_canteen_id()` requires the flag, so an unapproved row would be a
  // partner who silently sees no queue.
  const { error } = await supabase.rpc('admin_set_partner_canteen', {
    p_profile_id: profileId,
    p_canteen_id: canteenId,
    p_approved: true,
  });

  if (error) {
    redirect(`/canteens/${canteenId}?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath(`/canteens/${canteenId}`);
  redirect(`/canteens/${canteenId}`);
}

export async function setPartnerActive(
  canteenId: string,
  profileId: string,
  active: boolean,
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_set_partner_active', {
    p_profile_id: profileId,
    p_canteen_id: canteenId,
    p_active: active,
  });

  if (error) {
    redirect(`/canteens/${canteenId}?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath(`/canteens/${canteenId}`);
  redirect(`/canteens/${canteenId}`);
}
