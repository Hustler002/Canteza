import { describe, expect, it } from 'vitest';
import { checkOrderPlacement, type CanteenSnapshot, type MenuItemSnapshot } from '../src/rules';
import type { CartLine } from '../src/pricing';

const canteen: CanteenSnapshot = {
  id: 'main',
  isOpen: true,
  isAcceptingOrders: true,
  minOrderPaise: 5000,
};

const items = new Map<string, MenuItemSnapshot>([
  ['maggi', { id: 'maggi', canteenId: 'main', isAvailable: true }],
  ['samosa', { id: 'samosa', canteenId: 'main', isAvailable: false }],
  ['juice', { id: 'juice', canteenId: 'juice-corner', isAvailable: true }],
]);

const lines: CartLine[] = [{ itemId: 'maggi', unitPricePaise: 4000, quantity: 2 }];

const check = (overrides: Partial<Parameters<typeof checkOrderPlacement>[0]> = {}) =>
  checkOrderPlacement({ canteen, lines, items, subtotalPaise: 8000, ...overrides });

describe('order placement rules', () => {
  it('accepts a valid cart', () => {
    expect(check()).toBeNull();
  });

  it('blocks an empty cart', () => {
    expect(check({ lines: [] })?.code).toBe('CART_EMPTY');
  });

  it('blocks a closed canteen', () => {
    expect(check({ canteen: { ...canteen, isOpen: false } })?.code).toBe('CANTEEN_CLOSED');
  });

  it('blocks a canteen that has paused new orders', () => {
    expect(check({ canteen: { ...canteen, isAcceptingOrders: false } })?.code).toBe(
      'CANTEEN_CLOSED',
    );
  });

  it('blocks an unavailable item', () => {
    expect(check({ lines: [{ itemId: 'samosa', unitPricePaise: 2000, quantity: 1 }] })?.code).toBe(
      'ITEM_UNAVAILABLE',
    );
  });

  it('blocks an unknown item id', () => {
    expect(check({ lines: [{ itemId: 'ghost', unitPricePaise: 100, quantity: 1 }] })?.code).toBe(
      'ITEM_UNAVAILABLE',
    );
  });

  it('blocks items from another canteen', () => {
    expect(check({ lines: [{ itemId: 'juice', unitPricePaise: 3000, quantity: 1 }] })?.code).toBe(
      'CART_MIXED_CANTEENS',
    );
  });

  it('blocks nonsense quantities', () => {
    expect(check({ lines: [{ itemId: 'maggi', unitPricePaise: 4000, quantity: 0 }] })?.code).toBe(
      'INVALID_QUANTITY',
    );
    expect(check({ lines: [{ itemId: 'maggi', unitPricePaise: 4000, quantity: 999 }] })?.code).toBe(
      'INVALID_QUANTITY',
    );
  });

  it('blocks orders below the canteen minimum', () => {
    expect(check({ subtotalPaise: 4000 })?.code).toBe('BELOW_MINIMUM_ORDER');
  });
});
