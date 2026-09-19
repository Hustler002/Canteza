import type { OrderStatus } from './order-status';

/**
 * Notification content is derived from order state, in one place, so in-app
 * notifications and (later) push notifications never drift apart.
 */
export type NotificationAudience = 'student' | 'canteen' | 'delivery';

export type NotificationContent = {
  title: string;
  body: string;
};

export type OrderNotificationContext = {
  orderCode: string;
  canteenName: string;
  hostelLabel: string;
};

type Builder = (ctx: OrderNotificationContext) => NotificationContent;

const STUDENT: Partial<Record<OrderStatus, Builder>> = {
  pending: (c) => ({
    title: 'Order placed',
    body: `${c.canteenName} has your order ${c.orderCode}.`,
  }),
  accepted: (c) => ({
    title: 'Order accepted',
    body: `${c.canteenName} is starting on ${c.orderCode}.`,
  }),
  preparing: (c) => ({
    title: 'Being prepared',
    body: `Your food for ${c.orderCode} is on the stove.`,
  }),
  ready: () => ({ title: 'Ready for pickup', body: 'Waiting for a delivery partner.' }),
  assigned: () => ({ title: 'Partner assigned', body: 'A partner is heading to the canteen.' }),
  picked_up: (c) => ({ title: 'On the way', body: `Your food is heading to ${c.hostelLabel}.` }),
  delivered: (c) => ({ title: 'Delivered', body: `Enjoy! Rate ${c.orderCode} to help others.` }),
  cancelled: (c) => ({ title: 'Order cancelled', body: `${c.orderCode} was cancelled.` }),
  rejected: (c) => ({
    title: 'Order rejected',
    body: `${c.canteenName} could not take ${c.orderCode}.`,
  }),
};

const CANTEEN: Partial<Record<OrderStatus, Builder>> = {
  pending: (c) => ({ title: 'New order', body: `${c.orderCode} needs accepting.` }),
  cancelled: (c) => ({
    title: 'Order cancelled',
    body: `${c.orderCode} was cancelled. Stop preparing it.`,
  }),
};

const DELIVERY: Partial<Record<OrderStatus, Builder>> = {
  ready: (c) => ({
    title: 'Delivery available',
    body: `${c.orderCode} at ${c.canteenName} → ${c.hostelLabel}.`,
  }),
  cancelled: (c) => ({ title: 'Delivery cancelled', body: `${c.orderCode} is no longer active.` }),
};

const BY_AUDIENCE: Record<NotificationAudience, Partial<Record<OrderStatus, Builder>>> = {
  student: STUDENT,
  canteen: CANTEEN,
  delivery: DELIVERY,
};

/** Returns null when this audience should not be notified about this status. */
export function orderNotification(
  audience: NotificationAudience,
  status: OrderStatus,
  ctx: OrderNotificationContext,
): NotificationContent | null {
  return BY_AUDIENCE[audience][status]?.(ctx) ?? null;
}
