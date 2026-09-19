import type { OrderStatus, Row } from '@canteza/shared';
import type { CampusClient } from './client';
import { unwrap, unwrapList, unwrapRequired } from './errors';

/**
 * Orders.
 *
 * Reads are plain PostgREST selects, scoped by RLS. Writes are never plain: clients
 * hold no INSERT or UPDATE grant on `orders`, so everything here goes through an
 * RPC that validates server-side.
 */

export type Order = Row<'orders'>;
export type OrderItem = Row<'order_items'>;
export type OrderWithItems = Order & { order_items: OrderItem[] };

const ORDER_WITH_ITEMS = '*, order_items(*)';

export type PlaceOrderInput = {
  canteenId: string;
  /** Ids and quantities only. Prices are re-read server-side and cannot be sent. */
  items: Array<{ itemId: string; quantity: number }>;
  hostelId: string;
  block: string;
  room: string;
  /**
   * Generated once when checkout opens, not per submit. That is what makes a
   * double tap — or a retry after a dropped response — resolve to one order.
   */
  idempotencyKey: string;
  note?: string;
  couponCode?: string | null;
};

/** Returns the new order's id, or the existing one if this key was already used. */
export async function placeOrder(client: CampusClient, input: PlaceOrderInput): Promise<string> {
  return unwrapRequired(
    client.rpc('place_order', {
      p_canteen_id: input.canteenId,
      p_items: input.items.map((line) => ({ item_id: line.itemId, quantity: line.quantity })),
      p_hostel_id: input.hostelId,
      p_block: input.block,
      p_room: input.room.trim(),
      p_idempotency_key: input.idempotencyKey,
      p_note: input.note?.trim() ?? '',
      // The key is omitted rather than set to undefined: exactOptionalPropertyTypes
      // makes those different, and PostgREST would send an explicit null.
      ...(input.couponCode ? { p_coupon_code: input.couponCode } : {}),
      // COD is the only settled method until Razorpay lands in Phase 8; a prepaid
      // order is blocked from being accepted until payment verifies (ADR 006).
      p_payment_method: 'cod',
    }),
    'place_order',
  );
}

/**
 * Moves an order. The server derives the actor from the caller's relationship to the
 * order and checks the transition table, so a client cannot claim to be the canteen.
 */
export async function transitionOrder(
  client: CampusClient,
  orderId: string,
  to: OrderStatus,
  reason?: string,
): Promise<string> {
  return unwrapRequired(
    client.rpc('transition_order', {
      p_order_id: orderId,
      p_to: to,
      ...(reason ? { p_reason: reason } : {}),
    }),
    'transition_order',
  );
}

export async function getOrder(
  client: CampusClient,
  orderId: string,
): Promise<OrderWithItems | null> {
  return unwrap(
    client.from('orders').select(ORDER_WITH_ITEMS).eq('id', orderId).maybeSingle(),
  ) as Promise<OrderWithItems | null>;
}

/** A student's own orders, newest first. RLS limits this to theirs. */
export async function listMyOrders(client: CampusClient, limit = 20): Promise<OrderWithItems[]> {
  return unwrapList(
    client
      .from('orders')
      .select(ORDER_WITH_ITEMS)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as Promise<OrderWithItems[]>;
}

/**
 * The one order a student is currently watching, if any. Terminal orders are not
 * "active" -- a delivered order belongs in history, not on the tracker.
 */
export async function getActiveOrder(client: CampusClient): Promise<OrderWithItems | null> {
  const rows = (await unwrapList(
    client
      .from('orders')
      .select(ORDER_WITH_ITEMS)
      .not('status', 'in', '(delivered,cancelled,rejected)')
      .order('created_at', { ascending: false })
      .limit(1),
  )) as OrderWithItems[];
  return rows[0] ?? null;
}

/**
 * A canteen's orders. RLS already restricts this to the caller's own canteen, so
 * the status filter is presentation, not a permission check.
 */
export async function listCanteenOrders(
  client: CampusClient,
  statuses: readonly OrderStatus[],
  limit = 50,
): Promise<OrderWithItems[]> {
  return unwrapList(
    client
      .from('orders')
      .select(ORDER_WITH_ITEMS)
      .in('status', statuses as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as Promise<OrderWithItems[]>;
}

export async function getOrderHistory(
  client: CampusClient,
  orderId: string,
): Promise<Array<Row<'order_status_history'>>> {
  return unwrapList(
    client
      .from('order_status_history')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true }),
  );
}
