import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getIdentity, queryKeys, type Identity } from '@canteza/api';
import { toAppError, type AppError } from '@canteza/shared';
import { supabase } from './supabase';
import { queryClient } from './query';
import { unregisterForPush } from './push';
import { signOutConsequence } from './sign-out';
import { confirm } from './dialog';
import { identify } from './sentry';
import { useCart } from '../store/cart';

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

/**
 * Everything one account leaves on the phone, dropped when they leave it.
 *
 * The query cache is the obvious half. The cart is the other: it is persisted to
 * AsyncStorage so a hostel phone killing the app does not lose a half-built order, which
 * also means it outlives a sign-out -- and the next student on a shared phone would open
 * the app to someone else's basket. Harmless while only counter and delivery accounts
 * could sign out, since neither has a cart; not once students can.
 */
function clearAccountState(): void {
  queryClient.clear();
  useCart.getState().clear();
  // Events after sign-out must not be filed against the person who just left.
  identify(null);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  async function load(): Promise<void> {
    try {
      setError(null);
      const next = await getIdentity(supabase);
      setIdentity(next);
      identify(next ? { userId: next.userId, role: next.role } : null);
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
        clearAccountState();
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
        // First, while the session still exists: removing the device is the owner
        // deleting their own row, and after sign-out there is no owner to ask.
        await unregisterForPush();
        await supabase.auth.signOut();
        clearAccountState();
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

/**
 * Sign out, after asking. **Every sign-out control calls this, never `signOut` directly**
 * -- `apps/mobile/test/sign-out.test.ts` holds that on the source.
 *
 * Each screen used to wire its own, and they drifted: the student's asked, the counter's
 * and the delivery partner's signed out on a single stray tap. The button sits in a header
 * a thumb crosses constantly, and signing out is not free -- this phone stops getting the
 * account's notifications, and a student's cart is emptied -- so the prompt says what
 * will actually happen, for the role actually signed in.
 */
export function useConfirmSignOut(): () => void {
  const { signOut, identity } = useSession();

  return () => {
    confirm({
      title: 'Sign out?',
      message: signOutConsequence(identity?.role, useCart.getState().lines.length),
      cancelLabel: 'Stay signed in',
      confirmLabel: 'Sign out',
      destructive: true,
      onConfirm: () => void signOut(),
    });
  };
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
