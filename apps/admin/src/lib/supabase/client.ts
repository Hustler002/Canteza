'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { CampusClient } from '@canteza/api';
import type { Database } from '@canteza/shared';

/** createBrowserClient is already a singleton, so this can be called freely. */
export function createClientSupabase(): CampusClient {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ) as CampusClient;
}
