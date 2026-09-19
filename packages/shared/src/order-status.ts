import { AppError, ERROR_CODES } from './errors';
import type { Role } from './roles';

/**
 * Order lifecycle. This table is the specification; the authoritative enforcement
 * lives in Postgres (see supabase/migrations) and is kept identical to this file.
 *
 * `out_for_delivery` is deliberately absent: on a walkable campus, "picked up" and
 * "out for delivery" are the same physical moment, and one tap is better than two
 * for a partner holding a phone. Students see `picked_up` as "On the way".
 */
export const ORDER_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'assigned',
  'picked_up',
  'delivered',
  'cancelled',
  'rejected',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** `system` covers automated transitions (timeouts, payment failure cleanup). */
export type Actor = Role | 'system';

type TransitionMap = Readonly<
  Record<OrderStatus, Readonly<Partial<Record<OrderStatus, readonly Actor[]>>>>
>;

export const ORDER_TRANSITIONS: TransitionMap = {
  pending: {
    accepted: ['canteen', 'admin'],
    rejected: ['canteen', 'admin'],
    cancelled: ['student', 'admin', 'system'],
  },
  accepted: {
    preparing: ['canteen', 'admin'],
    cancelled: ['admin', 'system'],
  },
  preparing: {
    ready: ['canteen', 'admin'],
    cancelled: ['admin'],
  },
  ready: {
    assigned: ['delivery', 'admin'],
    cancelled: ['admin'],
  },
  assigned: {
    picked_up: ['delivery', 'admin'],
    // Partner abandons the claim: back to the open pool, no penalty in MVP.
    ready: ['delivery', 'admin'],
    cancelled: ['admin'],
  },
  picked_up: {
    delivered: ['delivery', 'admin'],
    cancelled: ['admin'],
  },
  delivered: {},
  cancelled: {},
  rejected: {},
};

export const TERMINAL_STATUSES = [
  'delivered',
  'cancelled',
  'rejected',
] as const satisfies readonly OrderStatus[];

export function isTerminal(status: OrderStatus): boolean {
  return (TERMINAL_STATUSES as readonly OrderStatus[]).includes(status);
}

/** True once the canteen has committed kitchen time — students can no longer self-cancel. */
export function isActive(status: OrderStatus): boolean {
  return !isTerminal(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return ORDER_TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) {
    throw new AppError(ERROR_CODES.INVALID_TRANSITION, { from, to, actor });
  }
}

/** What this actor is allowed to do next — drives which buttons a screen renders. */
export function nextStatusesFor(from: OrderStatus, actor: Actor): OrderStatus[] {
  return Object.entries(ORDER_TRANSITIONS[from])
    .filter(([, actors]) => actors.includes(actor))
    .map(([to]) => to as OrderStatus);
}

export function canStudentCancel(status: OrderStatus): boolean {
  return canTransition(status, 'cancelled', 'student');
}

/** Statuses where the order is in the delivery partner's hands. */
export function isWithPartner(status: OrderStatus): boolean {
  return status === 'assigned' || status === 'picked_up';
}

export const STUDENT_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Waiting for canteen',
  accepted: 'Order accepted',
  preparing: 'Being prepared',
  ready: 'Ready for pickup',
  assigned: 'Partner assigned',
  picked_up: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rejected: 'Rejected by canteen',
};

/** Ordered steps for the student's progress tracker (excludes failure states). */
export const STUDENT_PROGRESS_STEPS = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'picked_up',
  'delivered',
] as const satisfies readonly OrderStatus[];

export function progressIndex(status: OrderStatus): number {
  if (status === 'assigned') return STUDENT_PROGRESS_STEPS.indexOf('ready');
  return (STUDENT_PROGRESS_STEPS as readonly OrderStatus[]).indexOf(status);
}
