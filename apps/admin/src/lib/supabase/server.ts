import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { CampusClient } from '@campuseats/api';
import type { Database } from '@campuseats/shared';

/**
 * Server-side Supabase client, backed by the request's cookies.
 *
 * Only the anon key is used, so RLS still applies: an admin sees everything because
 * their profile says `role = 'admin'`, not because this client is privileged. The
 * service role key never appears in this app.
 */
export async function createServerSupabase(): Promise<CampusClient> {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot write cookies. The proxy
            // refreshes the session instead, so this is safe to ignore.
          }
        },
      },
    },
  ) as CampusClient;
}
