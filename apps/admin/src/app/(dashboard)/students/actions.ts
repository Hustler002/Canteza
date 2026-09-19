'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isRole, toAppError } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Account administration.
 *
 * Both are RPCs because both write columns no client holds a grant on — `profiles.role`
 * has never had one, and `is_active` had no writer at all until the migration that came
 * with this page. Neither will let an admin lock themselves out: the page hides the
 * controls on your own row and the functions refuse it regardless.
 */

function messageFor(error: unknown): string {
  return toAppError(error).userMessage;
}

export async function setProfileRole(formData: FormData): Promise<void> {
  const profileId = formData.get('profile_id');
  const role = formData.get('role');

  if (typeof profileId !== 'string' || !profileId || !isRole(role)) {
    redirect(`/students?error=${encodeURIComponent('Pick a role to set.')}`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_set_role', {
    p_profile_id: profileId,
    p_role: role,
  });

  if (error) {
    redirect(`/students?error=${encodeURIComponent(messageFor(error))}`);
  }

  // A role change moves someone between the canteen, delivery and student apps, and the
  // canteen page filters its pickers by role.
  revalidatePath('/students');
  revalidatePath('/canteens', 'layout');
  redirect('/students');
}

export async function setProfileActive(profileId: string, active: boolean): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_set_profile_active', {
    p_profile_id: profileId,
    p_active: active,
  });

  if (error) {
    redirect(`/students?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath('/students');
  redirect('/students');
}
