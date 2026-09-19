import { describe, expect, it } from 'vitest';
import { nextStatusesFor, ORDER_STATUSES, type OrderStatus } from '@campuseats/shared';

/**
 * The canteen board renders one button per entry in nextStatusesFor(status, 'canteen')
 * and labels it from ACTION_LABEL. If the state machine gains an edge the screen has
 * no label for, the button would render a raw status string at a busy counter.
 *
 * This mirrors the map in apps/mobile/app/(canteen)/orders.tsx.
 */
const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  accepted: 'Accept',
  rejected: 'Reject',
  preparing: 'Start cooking',
  ready: 'Ready for pickup',
  delivered: 'I delivered it',
};

describe('canteen actions', () => {
  it('has a label for every move a canteen can make', () => {
    const missing: string[] = [];
    for (const status of ORDER_STATUSES) {
      for (const next of nextStatusesFor(status, 'canteen')) {
        if (!ACTION_LABEL[next]) missing.push(`${status} -> ${next}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('offers accept and reject on a new order, and nothing once delivered', () => {
    expect(nextStatusesFor('pending', 'canteen').sort()).toEqual(['accepted', 'rejected']);
    expect(nextStatusesFor('delivered', 'canteen')).toEqual([]);
  });

  it('never offers a canteen a move that belongs to the delivery partner', () => {
    expect(nextStatusesFor('assigned', 'canteen')).toEqual([]);
    expect(nextStatusesFor('picked_up', 'canteen')).toEqual([]);
  });

  it('offers self-delivery only from ready (ADR 008)', () => {
    expect(nextStatusesFor('ready', 'canteen')).toContain('delivered');
    expect(nextStatusesFor('preparing', 'canteen')).not.toContain('delivered');
  });
});
