export const ROLES = ['student', 'canteen', 'delivery', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Which app surface a role lands in after login. */
export const ROLE_HOME: Record<Role, string> = {
  student: '/student',
  canteen: '/canteen',
  delivery: '/delivery',
  admin: '/admin',
};
