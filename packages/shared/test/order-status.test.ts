import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  assertTransition,
  canStudentCancel,
  canTransition,
  isTerminal,
  nextStatusesFor,
  progressIndex,
  type OrderStatus,
} from '../src/order-status';
import { AppError } from '../src/errors';

describe('order state machine', () => {
  it('lets the canteen accept or reject a pending order', () => {
    expect(canTransition('pending', 'accepted', 'canteen')).toBe(true);
    expect(canTransition('pending', 'rejected', 'canteen')).toBe(true);
  });

  it('refuses transitions the actor does not own', () => {
    expect(canTransition('pending', 'accepted', 'student')).toBe(false);
    expect(canTransition('ready', 'assigned', 'canteen')).toBe(false);
    expect(canTransition('preparing', 'delivered', 'delivery')).toBe(false);
  });

  it('refuses skipping steps', () => {
    expect(canTransition('pending', 'delivered', 'admin')).toBe(false);
    expect(canTransition('accepted', 'ready', 'canteen')).toBe(false);
  });

  it('treats terminal states as final for everyone including admin', () => {
    for (const status of ['delivered', 'cancelled', 'rejected'] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(Object.keys(ORDER_TRANSITIONS[status])).toHaveLength(0);
    }
  });

  it('only allows a student to cancel before the canteen commits', () => {
    expect(canStudentCancel('pending')).toBe(true);
    expect(canStudentCancel('accepted')).toBe(false);
    expect(canStudentCancel('preparing')).toBe(false);
  });

  it('lets a partner return a claimed order to the pool', () => {
    expect(canTransition('assigned', 'ready', 'delivery')).toBe(true);
  });

  it('throws a typed error on an invalid transition', () => {
    expect(() => assertTransition('delivered', 'preparing', 'admin')).toThrow(AppError);
    try {
      assertTransition('delivered', 'preparing', 'admin');
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('exposes the actions a given actor can take', () => {
    expect(nextStatusesFor('pending', 'canteen').sort()).toEqual(['accepted', 'rejected']);
    expect(nextStatusesFor('pending', 'delivery')).toEqual([]);
    expect(nextStatusesFor('ready', 'delivery')).toEqual(['assigned']);
  });

  it('declares every status in the transition table', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('never points a transition at an unknown status', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of Object.keys(ORDER_TRANSITIONS[from])) {
        expect(ORDER_STATUSES).toContain(to as OrderStatus);
      }
    }
  });

  it('every non-terminal status can still reach a terminal one', () => {
    const reachesTerminal = (start: OrderStatus, seen = new Set<OrderStatus>()): boolean => {
      if (isTerminal(start)) return true;
      seen.add(start);
      return Object.keys(ORDER_TRANSITIONS[start]).some(
        (next) => !seen.has(next as OrderStatus) && reachesTerminal(next as OrderStatus, seen),
      );
    };
    for (const status of ORDER_STATUSES) {
      expect(reachesTerminal(status)).toBe(true);
    }
  });

  it('maps assigned onto the ready step of the student tracker', () => {
    expect(progressIndex('assigned')).toBe(progressIndex('ready'));
    expect(progressIndex('picked_up')).toBeGreaterThan(progressIndex('ready'));
    expect(progressIndex('cancelled')).toBe(-1);
  });
});
