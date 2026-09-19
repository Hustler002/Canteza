'use client';

import { useRouter } from 'next/navigation';
import { signOut } from '@campuseats/api';
import { createClientSupabase } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="button secondary"
      type="button"
      onClick={async () => {
        await signOut(createClientSupabase());
        router.replace('/login');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
