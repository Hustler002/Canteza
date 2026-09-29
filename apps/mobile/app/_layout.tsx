// First, so a crash anywhere below -- including while the rest of this file loads --
// is already being watched.
import { Sentry } from '../src/lib/sentry';
import { registerDevTools } from '../src/lib/dev-menu';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { ROLE_HOME, type Role } from '@canteza/shared';
import { queryClient } from '../src/lib/query';
import { SessionProvider, useSession } from '../src/lib/session';
import { isNewResponse, registerForPush, routeForPush } from '../src/lib/push';
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
      {/*
       * Not on the web: expo-notifications has no getLastNotificationResponse there, so
       * useLastNotificationResponse throws UnavailabilityError the moment anyone signs in.
       * Web push would be a service worker and VAPID keys -- a separate piece of work; the
       * inbox and realtime order updates already work in the browser without it.
       */}
      {identity && Platform.OS !== 'web' ? (
        <PushBridge userId={identity.userId} role={identity.role} />
      ) : null}
    </>
  );
}

/**
 * Push, for whoever is signed in: register this device with them, and open the right
 * screen when a notification is tapped -- including the tap that launched the app.
 *
 * Navigation happens in an effect, never during render (rule 18a), and each tap is acted
 * on once per device, ever. The ref catches a re-render; `isNewResponse` catches what the
 * ref cannot -- Android replays the tap that cold-started the app to every new JavaScript
 * runtime, so after a reload the same tap arrives again looking brand new, and before this
 * guard it dropped the student back onto that order (found on the device, 2026-09-28).
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
    if (!route) return;
    void isNewResponse(id).then((fresh) => {
      if (fresh) router.push(route as never);
    });
  }, [response, role, router]);

  return null;
}

/**
 * Wrapped so Sentry sees the whole tree: touch breadcrumbs and the root error boundary
 * come from `Sentry.wrap`, and cost nothing when no DSN is configured.
 */
registerDevTools();

function RootLayout() {
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

export default Sentry.wrap(RootLayout);
