/**
 * The single registry of TanStack Query keys (ADR 004).
 *
 * Realtime handlers invalidate by key, and screens read by key. If those two ever
 * disagree about the shape of a key, a live update silently stops arriving and
 * nothing fails loudly. So there is exactly one place a key is spelled.
 */
export const queryKeys = {
  session: () => ['session'] as const,
  profile: (userId: string) => ['profile', userId] as const,

  canteens: () => ['canteens'] as const,
  canteen: (canteenId: string) => ['canteens', canteenId] as const,
  menu: (canteenId: string) => ['canteens', canteenId, 'menu'] as const,
  categories: () => ['categories'] as const,
  hostels: () => ['hostels'] as const,

  /** A student's own orders. */
  myOrders: () => ['orders', 'mine'] as const,
  order: (orderId: string) => ['orders', orderId] as const,
  orderHistory: (orderId: string) => ['orders', orderId, 'history'] as const,

  /** Everything a canteen sees, optionally narrowed to one status. */
  canteenOrders: (canteenId: string, status?: string) =>
    status
      ? (['orders', 'canteen', canteenId, status] as const)
      : (['orders', 'canteen', canteenId] as const),

  /** A partner's own canteen's unclaimed ready queue, and their own assignments. */
  deliveryQueue: () => ['orders', 'delivery', 'queue'] as const,
  myDeliveries: (partnerId: string) => ['orders', 'delivery', partnerId, 'active'] as const,
  deliveryHistory: (partnerId: string) => ['orders', 'delivery', partnerId, 'history'] as const,
  shift: (partnerId: string) => ['shift', partnerId] as const,

  notifications: (userId: string) => ['notifications', userId] as const,
} as const;

/** Broad invalidation targets — prefer these over surgical keys (ADR 004). */
export const invalidationRoots = {
  orders: ['orders'] as const,
  canteens: ['canteens'] as const,
  notifications: ['notifications'] as const,
} as const;
