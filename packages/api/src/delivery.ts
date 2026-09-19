import type { CampusClient } from './client';
import { unwrap, unwrapList, unwrapRequired } from './errors';
import type { OrderWithItems } from './orders';

/**
 * The delivery partner's world, which is exactly one canteen's (ADR 008).
 *
 * None of these functions take a canteen id. RLS resolves the caller's posting
 * server-side, so a partner cannot ask about another canteen's work even by trying —
 * and there is no parameter here to tamper with.
 */

const ORDER_WITH_ITEMS = '*, order_items(*)';

/**
 * Unclaimed `ready` orders from the partner's own canteen.
 *
 * Returns nothing when the partner is off shift: `my_delivery_canteen_id()` checks
 * `is_online`, so the policy that exposes this queue stops matching.
 */
export async function listDeliveryQueue(client: CampusClient): Promise<OrderWithItems[]> {
  return unwrapList(
    client
      .from('orders')
      .select(ORDER_WITH_ITEMS)
      .eq('status', 'ready')
      .is('delivery_partner_id', null)
      .order('created_at', { ascending: true }),
  ) as Promise<OrderWithItems[]>;
}

/** Orders this partner is currently carrying. Visible on or off shift. */
export async function listActiveDeliveries(
  client: CampusClient,
  partnerId: string,
): Promise<OrderWithItems[]> {
  return unwrapList(
    client
      .from('orders')
      .select(ORDER_WITH_ITEMS)
      .eq('delivery_partner_id', partnerId)
      .in('status', ['assigned', 'picked_up'])
      .order('created_at', { ascending: true }),
  ) as Promise<OrderWithItems[]>;
}

export async function listCompletedDeliveries(
  client: CampusClient,
  partnerId: string,
  limit = 50,
): Promise<OrderWithItems[]> {
  return unwrapList(
    client
      .from('orders')
      .select(ORDER_WITH_ITEMS)
      .eq('delivery_partner_id', partnerId)
      .eq('status', 'delivered')
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as Promise<OrderWithItems[]>;
}

/**
 * Takes an order from the queue. Atomic: the losing partner of a simultaneous tap
 * gets `DELIVERY_ALREADY_CLAIMED`, which is a real outcome to show, not something to
 * retry. `OFF_SHIFT` means exactly that, and is distinct from `FORBIDDEN`.
 */
export async function claimDelivery(client: CampusClient, orderId: string): Promise<string> {
  return unwrapRequired(client.rpc('claim_delivery', { p_order_id: orderId }), 'claim_delivery');
}

/** Hands an order back to the canteen's queue, unassigned. */
export async function releaseDelivery(client: CampusClient, orderId: string): Promise<string> {
  return unwrapRequired(
    client.rpc('release_delivery', { p_order_id: orderId }),
    'release_delivery',
  );
}

export type ShiftState = {
  isOnline: boolean;
  isApproved: boolean;
  isActive: boolean;
};

export async function getShiftState(
  client: CampusClient,
  partnerId: string,
): Promise<ShiftState | null> {
  const row = await unwrap(
    client
      .from('delivery_partners')
      .select('is_online, is_approved, is_active')
      .eq('profile_id', partnerId)
      .eq('is_active', true)
      .maybeSingle(),
  );
  if (!row) return null;
  return { isOnline: row.is_online, isApproved: row.is_approved, isActive: row.is_active };
}

/** `is_online` is the only column on this table a client may write. */
export async function setOnline(
  client: CampusClient,
  partnerId: string,
  online: boolean,
): Promise<void> {
  await unwrap(
    client
      .from('delivery_partners')
      .update({ is_online: online })
      .eq('profile_id', partnerId)
      .eq('is_active', true)
      .select('profile_id'),
  );
}

export type DeliveryStats = {
  today: number;
  week: number;
  total: number;
  /** Minutes from claim to delivered, averaged over completed deliveries. */
  averageMinutes: number | null;
};

/**
 * Counts, not money.
 *
 * The canteen employs and pays its delivery staff (ADR 008), so the platform does
 * not know the rate and will not invent one. `orders.platform_fee_paise` is our cut
 * of the delivery fee, not theirs, and showing it here would be a lie.
 */
export function summariseDeliveries(
  completed: Array<{ created_at: string; updated_at: string }>,
  now = new Date(),
): DeliveryStats {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  let today = 0;
  let week = 0;
  let minutesTotal = 0;
  let timed = 0;

  for (const order of completed) {
    const placed = new Date(order.created_at);
    if (placed >= startOfToday) today += 1;
    if (placed >= startOfWeek) week += 1;

    // updated_at is the last transition, which for a delivered order is the drop.
    const finished = new Date(order.updated_at);
    const minutes = (finished.getTime() - placed.getTime()) / 60_000;
    if (Number.isFinite(minutes) && minutes >= 0) {
      minutesTotal += minutes;
      timed += 1;
    }
  }

  return {
    today,
    week,
    total: completed.length,
    averageMinutes: timed === 0 ? null : Math.round(minutesTotal / timed),
  };
}
