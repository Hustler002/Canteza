'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toAppError } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { parseBlocks } from '@/lib/people-filters';

/**
 * Hostels.
 *
 * The one place in this app an admin write is a plain table write rather than an RPC:
 * `hostels_admin` is the only policy offering a WITH CHECK, no other role writes the
 * table, and no column here needs withholding — so the grant and the policy already say
 * everything a function would. DELETE is revoked; disabling is the retirement path.
 */

const UNIQUE_VIOLATION = '23505';

function messageFor(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    if ((error as { code: unknown }).code === UNIQUE_VIOLATION) {
      return 'Another hostel already has that name.';
    }
  }
  return toAppError(error).userMessage;
}

type Parsed = { name: string; blocks: string[] };

function read(formData: FormData): Parsed | null {
  const name = formData.get('name');
  if (typeof name !== 'string' || !name.trim()) return null;
  const blocks = formData.get('blocks');
  return {
    name: name.trim().slice(0, 80),
    blocks: parseBlocks(typeof blocks === 'string' ? blocks : ''),
  };
}

export async function createHostel(formData: FormData): Promise<void> {
  const parsed = read(formData);
  if (!parsed) {
    redirect(`/hostels?error=${encodeURIComponent('A hostel needs a name.')}`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('hostels').insert(parsed);

  if (error) {
    redirect(`/hostels?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath('/hostels');
  redirect(`/hostels?saved=${encodeURIComponent(parsed.name)}`);
}

export async function updateHostel(hostelId: string, formData: FormData): Promise<void> {
  const parsed = read(formData);
  if (!parsed) {
    redirect(`/hostels?error=${encodeURIComponent('A hostel needs a name.')}`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('hostels').update(parsed).eq('id', hostelId);

  if (error) {
    redirect(`/hostels?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath('/hostels');
  redirect(`/hostels?saved=${encodeURIComponent(parsed.name)}`);
}

export async function setHostelActive(hostelId: string, active: boolean): Promise<void> {
  const supabase = await createServerSupabase();
  // Not a delete: students living here keep their saved address, and every order ever
  // delivered to the building keeps resolving.
  const { error } = await supabase.from('hostels').update({ is_active: active }).eq('id', hostelId);

  if (error) {
    redirect(`/hostels?error=${encodeURIComponent(messageFor(error))}`);
  }

  revalidatePath('/hostels');
  redirect('/hostels');
}
