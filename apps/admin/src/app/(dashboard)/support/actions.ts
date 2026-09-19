'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toAppError } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Working a complaint.
 *
 * `support_tickets_admin` is the only UPDATE policy on the table, and the student's
 * own policy is SELECT and INSERT only — so an admin is the only one who can move a
 * ticket's status or write a resolution, and a student can read the answer but never
 * mark their own complaint resolved. That is the whole authorisation model, already
 * in SQL, which is why this is a table write rather than an RPC (as with `hostels`).
 */

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
type Status = (typeof STATUSES)[number];

function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export async function updateTicket(ticketId: string, formData: FormData): Promise<void> {
  const status = formData.get('status');
  if (!isStatus(status)) {
    redirect(`/support?error=${encodeURIComponent('That is not a status a ticket can be in.')}`);
  }

  const resolution = formData.get('resolution');
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('support_tickets')
    .update({
      status,
      // Empty means "nothing written back yet", which is null rather than a blank
      // string — the student's screen shows the resolution card only when there is one.
      resolution: typeof resolution === 'string' && resolution.trim() ? resolution.trim() : null,
    })
    .eq('id', ticketId);

  if (error) {
    redirect(`/support?error=${encodeURIComponent(toAppError(error).userMessage)}`);
  }

  revalidatePath('/support');
  redirect('/support?saved=1');
}
