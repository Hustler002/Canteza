import { Stack } from 'expo-router';
import { useSession } from '../lib/session';

/**
 * The navigator for a signed-in role group -- `(student)`, `(canteen)`, `(delivery)`.
 *
 * **It renders nothing once nobody is signed in**, which is the whole point of it. Sign-out
 * clears the identity, React re-renders every screen that reads the session, and only
 * *after* that render does the root guard's effect navigate to sign-in. Without this, any
 * screen still mounted renders in that gap with no one signed in, and `useIdentity()` --
 * which throws, deliberately -- takes the app down. Found on the device (2026-09-28): the
 * counter signed out and got "useIdentity used outside a signed-in route" from
 * `(canteen)/orders.tsx`. Unmounting the group in the same render that clears the
 * identity leaves no screen to be caught in the gap.
 *
 * Every role group uses this, so none can forget it.
 */
export function SignedInStack() {
  const { identity } = useSession();
  if (!identity) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
