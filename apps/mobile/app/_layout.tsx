import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { ROLE_HOME } from '@campuseats/shared';
import { queryClient } from '../src/lib/query';
import { SessionProvider, useSession } from '../src/lib/session';
import { Loading } from '../src/components/ui';
import { useTheme } from '../src/theme';

/**
 * Role-based routing.
 *
 * Each role gets its own route group, and this decides which one you are allowed to
 * be in. It is navigation, not security: the database enforces the same boundaries
 * independently (see supabase/migrations). Someone who patches this out gets a
 * canteen's menu screen and no canteen's data.
 */

const GROUP_FOR_ROLE = {
  student: '(student)',
  canteen: '(canteen)',
  delivery: '(delivery)',
  // No admin app on mobile; admins use the web dashboard.
  admin: '(student)',
} as const;

function RouteGuard() {
  const { loading, identity } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const t = useTheme();

  useEffect(() => {
    if (loading) return;

    const group = segments[0];
    const inAuth = group === '(auth)';

    if (!identity) {
      if (!inAuth) router.replace('/sign-in');
      return;
    }

    const expected = GROUP_FOR_ROLE[identity.role];
    // Signed in but sitting in the auth group, or in another role's tree.
    if (inAuth || (group !== undefined && group.startsWith('(') && group !== expected)) {
      router.replace(ROLE_HOME[identity.role] as never);
    }
  }, [loading, identity, segments, router]);

  if (loading) {
    return <Loading label="Signing you in…" />;
  }

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.color.background } }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(student)" />
      <Stack.Screen name="(canteen)" />
      <Stack.Screen name="(delivery)" />
    </Stack>
  );
}

export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style={t.dark ? 'light' : 'dark'} />
          <RouteGuard />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
