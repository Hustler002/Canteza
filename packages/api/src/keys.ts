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
  /** Ratings and kitchen speed. Its own key: it is cached far longer than the list. */
  canteenStats: () => ['canteens', 'stats'] as const,
  menu: (canteenId: string) => ['canteens', canteenId, 'menu'] as const,
  /** The counter's own view of it: retired items included, which a student never sees. */
  canteenMenu: (canteenId: string) => ['canteens', canteenId, 'menu', 'all'] as const,
  /** Dish search across canteens. Keyed by term so each one caches on its own. */
  menuSearch: (term: string) => ['menu', 'search', term] as const,
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

  /**
   * Per-status counts for the counter's tab badges. Nested under `orders`, so the
   * realtime handler's existing invalidation of that root refreshes the badges
   * along with the list — a new order bumps the count without its own subscription.
   */
  canteenOrderCounts: (canteenId: string) => ['orders', 'canteen', canteenId, 'counts'] as const,

  /** A partner's own canteen's unclaimed ready queue, and their own assignments. */
  deliveryQueue: () => ['orders', 'delivery', 'queue'] as const,
  myDeliveries: (partnerId: string) => ['orders', 'delivery', partnerId, 'active'] as const,
  deliveryHistory: (partnerId: string) => ['orders', 'delivery', partnerId, 'history'] as const,
  shift: (partnerId: string) => ['shift', partnerId] as const,

  notifications: (userId: string) => ['notifications', userId] as const,

  /** Engagement: the things that hang off an order rather than move it. */
  orderReview: (orderId: string) => ['orders', orderId, 'review'] as const,
  canteenReviews: (canteenId: string) => ['canteens', canteenId, 'reviews'] as const,
  favorites: () => ['favorites'] as const,
  coupons: () => ['coupons'] as const,
  tickets: (status?: string) => (status ? (['tickets', status] as const) : (['tickets'] as const)),
} as const;

/** Broad invalidation targets — prefer these over surgical keys (ADR 004). */
export const invalidationRoots = {
  orders: ['orders'] as const,
  canteens: ['canteens'] as const,
  notifications: ['notifications'] as const,
  favorites: ['favorites'] as const,
  tickets: ['tickets'] as const,
} as const;
