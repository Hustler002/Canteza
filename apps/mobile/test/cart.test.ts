import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store persists through AsyncStorage, which does not exist outside a device.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

const { useCart } = await import('../src/store/cart');

const MAIN = 'canteen-main';
const JUICE = 'canteen-juice';

beforeEach(() => {
  useCart.getState().clear();
});

describe('cart', () => {
  it('starts empty, with no canteen claimed', () => {
    expect(useCart.getState().lines).toEqual([]);
    expect(useCart.getState().canteenId).toBeNull();
  });

  it('adopts the canteen of the first item added', () => {
    useCart.getState().add(MAIN, 'maggi');
    expect(useCart.getState().canteenId).toBe(MAIN);
    expect(useCart.getState().lines).toEqual([{ itemId: 'maggi', quantity: 1 }]);
  });

  it('accumulates quantity instead of duplicating a line', () => {
    useCart.getState().add(MAIN, 'maggi');
    useCart.getState().add(MAIN, 'maggi', 2);
    expect(useCart.getState().lines).toEqual([{ itemId: 'maggi', quantity: 3 }]);
    expect(useCart.getState().totalUnits()).toBe(3);
  });

  it('stores no prices — the server owns the money', () => {
    useCart.getState().add(MAIN, 'maggi');
    const line = useCart.getState().lines[0]!;
    expect(Object.keys(line).sort()).toEqual(['itemId', 'quantity']);
  });

  it('flags a conflict before an item from another canteen is added', () => {
    useCart.getState().add(MAIN, 'maggi');
    expect(useCart.getState().wouldConflict(JUICE)).toBe(true);
    expect(useCart.getState().wouldConflict(MAIN)).toBe(false);
  });

  it('refuses a silent cross-canteen add rather than dropping the old cart', () => {
    useCart.getState().add(MAIN, 'maggi');
    useCart.getState().add(JUICE, 'shake');
    expect(useCart.getState().canteenId).toBe(MAIN);
    expect(useCart.getState().lines).toEqual([{ itemId: 'maggi', quantity: 1 }]);
  });

  it('replaces the whole cart when the student confirms the switch', () => {
    useCart.getState().add(MAIN, 'maggi', 3);
    useCart.getState().replaceWith(JUICE, 'shake');
    expect(useCart.getState().canteenId).toBe(JUICE);
    expect(useCart.getState().lines).toEqual([{ itemId: 'shake', quantity: 1 }]);
  });

  it('releases the canteen once the last line is removed, so the next add is free', () => {
    useCart.getState().add(MAIN, 'maggi');
    useCart.getState().remove('maggi');
    expect(useCart.getState().canteenId).toBeNull();
    expect(useCart.getState().wouldConflict(JUICE)).toBe(false);

    useCart.getState().add(JUICE, 'shake');
    expect(useCart.getState().canteenId).toBe(JUICE);
  });

  it('treats a zero or negative quantity as removal', () => {
    useCart.getState().add(MAIN, 'maggi', 2);
    useCart.getState().add(MAIN, 'tea');
    useCart.getState().setQuantity('maggi', 0);
    expect(useCart.getState().lines).toEqual([{ itemId: 'tea', quantity: 1 }]);
    expect(useCart.getState().canteenId).toBe(MAIN);
  });

  it('reports the quantity of an item, present or not', () => {
    useCart.getState().add(MAIN, 'maggi', 2);
    expect(useCart.getState().quantityOf('maggi')).toBe(2);
    expect(useCart.getState().quantityOf('nothing')).toBe(0);
  });
});
