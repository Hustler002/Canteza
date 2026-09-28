import * as Sentry from '@sentry/react-native';
import type { Role } from '@canteza/shared';
import { shouldReport } from './report';

/**
 * Crash and error reporting.
 *
 * **Off unless a DSN is configured**, so a clone without one -- or a test build someone
 * did not mean to report from -- sends nothing. The DSN is written out in full as
 * `process.env.EXPO_PUBLIC_SENTRY_DSN`, never computed: Expo inlines these at build time by
 * rewriting that exact text, and `test/env-inlining.test.ts` fails on anything else. A DSN
 * is designed to ship inside apps; it lets a client *send* events and read nothing.
 *
 * **What Sentry learns about a person: an opaque user id and a role.** Never a name,
 * email, phone or room -- students' rooms are exactly the detail that must not leave the
 * campus system. `sendDefaultPii: false` keeps the SDK from adding an IP address, and
 * `identify()` sets the id alone. An id is enough to find every event from one account
 * and join it to the database when debugging, which is all an event needs.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const sentryEnabled = Boolean(DSN);

Sentry.init({
  dsn: DSN,
  enabled: sentryEnabled,
  environment: __DEV__ ? 'development' : 'production',
  sendDefaultPii: false,
  // Errors only to begin with. Performance tracing costs quota on every screen, and
  // there is no slow path anyone has reported yet; turn it on for a reason, not a guess.
  tracesSampleRate: 0,
});

/** Tag events with who, as an id and a role and nothing else. */
export function identify(user: { userId: string; role: Role } | null): void {
  if (!user) {
    Sentry.setUser(null);
    Sentry.setTag('role', undefined);
    return;
  }
  Sentry.setUser({ id: user.userId });
  Sentry.setTag('role', user.role);
}

/** Report a handled error, if it is one nobody planned for (see `shouldReport`). */
export function reportIfUnexpected(error: unknown): void {
  if (shouldReport(error)) Sentry.captureException(error);
}

export { Sentry };
