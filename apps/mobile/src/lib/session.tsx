import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getIdentity, queryKeys, type Identity } from '@campuseats/api';
import { toAppError, type AppError } from '@campuseats/shared';
import { supabase } from './supabase';
import { queryClient } from './query';

/**
 * Who is signed in, and what they are allowed to see.
 *
 * The role comes from the user's own `profiles` row, never from anything the client
 * decides. It picks which navigation tree mounts; the database enforces the same
 * boundary independently, so tampering with this buys a different menu and no data.
 */

type SessionState = {
  /** True until the stored session has been checked — do not route before this. */
  loading: boolean;
  identity: Identity | null;
  error: AppError | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  async function load(): Promise<void> {
    try {
      setError(null);
      setIdentity(await getIdentity(supabase));
    } catch (err) {
      setError(toAppError(err));
      setIdentity(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();

    const { data } = supabase.auth.onAuthStateChange((event) => {
      // TOKEN_REFRESHED fires often and changes nothing about who the user is;
      // re-reading the profile on every one would be a query per hour per app.
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_OUT') {
        setIdentity(null);
        // Another account's data must not be sitting in the cache when the next
        // person signs in on the same phone.
        queryClient.clear();
        return;
      }
      void load();
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      loading,
      identity,
      error,
      signOut: async () => {
        await supabase.auth.signOut();
        queryClient.clear();
        setIdentity(null);
      },
      refresh: async () => {
        if (identity)
          await queryClient.invalidateQueries({ queryKey: queryKeys.profile(identity.userId) });
        await load();
      },
    }),
    [loading, identity, error],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/** For screens that only render behind a signed-in guard. */
export function useIdentity(): Identity {
  const { identity } = useSession();
  if (!identity) throw new Error('useIdentity used outside a signed-in route');
  return identity;
}
