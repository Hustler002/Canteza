export const ROLES = ['student', 'canteen', 'delivery', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Where each role lands after login.
 *
 * These are real route paths, not group names: expo-router strips parentheses from
 * URLs, so `app/(student)/home.tsx` is `/home`. Each role gets a distinct filename
 * rather than three competing `index.tsx` files that would all resolve to `/`.
 *
 * Admins have no mobile surface and are sent to the student tree, which is harmless:
 * `place_order` refuses a non-student, so they can look but not order.
 */
export const ROLE_HOME: Record<Role, string> = {
  student: '/home',
  canteen: '/orders',
  delivery: '/deliveries',
  admin: '/home',
};
