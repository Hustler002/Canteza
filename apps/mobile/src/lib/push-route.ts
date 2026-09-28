import type { Role } from '@canteza/shared';

/**
 * Kept apart from `push.ts` because it is pure: `push.ts` loads `expo-notifications` at
 * import, which no Node test can do, and this is the part worth testing.
 */

/** The role groups a push audience belongs to. An admin browses as a student. */
const AUDIENCE_FOR_ROLE: Record<Role, string> = {
  student: 'student',
  admin: 'student',
  canteen: 'canteen',
  delivery: 'delivery',
};

/**
 * Where a tapped notification should land, or null to stay put.
 *
 * Only for the audience of the person signed in now. A token moves with each sign-in,
 * so this should already hold -- but a notification that arrived just before an account
 * switch can still sit in the tray, and opening a canteen's board for a student would
 * be a screen the role guard immediately throws them out of.
 */
export function routeForPush(data: unknown, role: Role): string | null {
  const { orderId, audience } = (data ?? {}) as { orderId?: unknown; audience?: unknown };
  if (typeof audience !== 'string' || audience !== AUDIENCE_FOR_ROLE[role]) return null;

  switch (audience) {
    case 'student':
      return typeof orderId === 'string' ? `/order/${orderId}` : null;
    case 'canteen':
      return '/orders';
    case 'delivery':
      return '/deliveries';
    default:
      return null;
  }
}

/** The little of AsyncStorage `claimResponse` needs, so a test can hand it a Map. */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export const HANDLED_RESPONSE_KEY = 'push:last-handled-response';

/**
 * True the first time a tapped notification is seen on this device, false every time
 * after -- across remounts, sign-outs and JavaScript reloads.
 *
 * An in-memory "handled" flag is not enough, and clearing Expo's last response is not
 * either. On Android, the tap that cold-starts the app is kept in
 * `NotificationManager.pendingNotificationResponsesFromExtras`, which is never emptied,
 * and replayed to the notifications module every time it registers -- which is every
 * new JavaScript runtime, so every reload. Each replay carries the same identifier, so
 * remembering the last one handled, on disk, is what makes a replay harmless.
 *
 * If storage fails the answer is true: opening a screen twice is a nuisance, never
 * opening the one the student tapped is a bug.
 */
export async function claimResponse(identifier: string, store: KeyValueStore): Promise<boolean> {
  try {
    if ((await store.getItem(HANDLED_RESPONSE_KEY)) === identifier) return false;
    await store.setItem(HANDLED_RESPONSE_KEY, identifier);
  } catch {
    // fall through: see above
  }
  return true;
}

/** The two fields of an expo-notifications permission response that matter here. */
export type PermissionAnswer = { status: string; granted: boolean };

/**
 * May this device be sent pushes? Read `status`, **never `granted`**.
 *
 * On Android, expo-notifications sets `granted` from the POST_NOTIFICATIONS runtime
 * permission alone, while `status` also checks `areNotificationsEnabled()`
 * (`NotificationPermissionsModule.kt`). Switching notifications off in the phone's
 * settings can leave the permission held, so `granted` stays true and `status` says
 * "denied". That is read from the library source, not observed: the one device run that
 * seemed to show it had notifications switched on. What the device did prove is the
 * refused path -- with the app's notifications off, a start removes the registration.
 */
export function pushAllowed(permission: PermissionAnswer): boolean {
  return permission.status === 'granted';
}
