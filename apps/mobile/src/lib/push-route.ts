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
