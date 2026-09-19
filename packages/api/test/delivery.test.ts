import { describe, expect, it } from 'vitest';
import { nextStatusesFor, ORDER_STATUSES, type OrderStatus } from '@canteza/shared';
import { summariseDeliveries } from '../src/delivery';

/** Mirrors the label map in apps/mobile/app/(delivery)/deliveries.tsx. */
const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  picked_up: 'Picked it up',
  delivered: 'Delivered',
  ready: 'Give it back',
};

describe('delivery actions', () => {
  it('has a label for every move a partner can make', () => {
    const missing: string[] = [];
    for (const status of ORDER_STATUSES) {
      for (const next of nextStatusesFor(status, 'delivery')) {
        // ready -> assigned goes through claim_delivery, which is its own button.
        if (status === 'ready' && next === 'assigned') continue;
        if (!ACTION_LABEL[next]) missing.push(`${status} -> ${next}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('cannot move an order it does not hold', () => {
    expect(nextStatusesFor('pending', 'delivery')).toEqual([]);
    expect(nextStatusesFor('preparing', 'delivery')).toEqual([]);
  });

  it('can hand a claimed order back, and finish one it picked up', () => {
    expect(nextStatusesFor('assigned', 'delivery')).toContain('ready');
    expect(nextStatusesFor('picked_up', 'delivery')).toEqual(['delivered']);
  });

  it('is finished once delivered', () => {
    expect(nextStatusesFor('delivered', 'delivery')).toEqual([]);
  });
});

describe('summariseDeliveries', () => {
  const now = new Date('2026-09-19T20:00:00+05:30');
  const at = (iso: string, minutes: number) => ({
    created_at: iso,
    updated_at: new Date(new Date(iso).getTime() + minutes * 60_000).toISOString(),
  });

  it('counts today, the last seven days, and all time separately', () => {
    const stats = summariseDeliveries(
      [
        at('2026-09-19T13:00:00+05:30', 20),
        at('2026-09-19T09:00:00+05:30', 10),
        at('2026-09-16T19:00:00+05:30', 30),
        at('2026-08-01T19:00:00+05:30', 15),
      ],
      now,
    );
    expect(stats.today).toBe(2);
    expect(stats.week).toBe(3);
    expect(stats.total).toBe(4);
  });

  it('averages minutes from placed to delivered', () => {
    const stats = summariseDeliveries(
      [at('2026-09-19T13:00:00+05:30', 20), at('2026-09-19T14:00:00+05:30', 10)],
      now,
    );
    expect(stats.averageMinutes).toBe(15);
  });

  it('reports no average rather than zero when there is nothing to average', () => {
    const stats = summariseDeliveries([], now);
    expect(stats).toEqual({ today: 0, week: 0, total: 0, averageMinutes: null });
  });

  it('ignores a negative duration instead of dragging the average down', () => {
    const stats = summariseDeliveries(
      [at('2026-09-19T13:00:00+05:30', 20), at('2026-09-19T13:00:00+05:30', -60)],
      now,
    );
    expect(stats.averageMinutes).toBe(20);
  });

  it('reports counts only — the canteen pays the partner, so we cannot know earnings', () => {
    const stats = summariseDeliveries([at('2026-09-19T13:00:00+05:30', 20)], now);
    expect(Object.keys(stats).sort()).toEqual(['averageMinutes', 'today', 'total', 'week']);
  });
});
