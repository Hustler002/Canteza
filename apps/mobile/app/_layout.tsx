import { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { ROLE_HOME, type Role } from '@canteza/shared';
import { queryClient } from '../src/lib/query';
import { SessionProvider, useSession } from '../src/lib/session';
import { registerForPush, routeForPush } from '../src/lib/push';
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
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.color.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(student)" />
        <Stack.Screen name="(canteen)" />
        <Stack.Screen name="(delivery)" />
      </Stack>
      {identity ? <PushBridge userId={identity.userId} role={identity.role} /> : null}
    </>
  );
}

/**
 * Push, for whoever is signed in: register this device with them, and open the right
 * screen when a notification is tapped -- including the tap that launched the app.
 *
 * Navigation happens in an effect, never during render (rule 18a), and each response is
 * handled once and then cleared. Without the clear, signing out and back in remounts this
 * and replays the last tap, dropping someone onto an order from yesterday.
 */
function PushBridge({ userId, role }: { userId: string; role: Role }) {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    void registerForPush();
  }, [userId]);

  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    Notifications.clearLastNotificationResponse();

    const route = routeForPush(response.notification.request.content.data, role);
    if (route) router.push(route as never);
  }, [response, role, router]);

  return null;
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
