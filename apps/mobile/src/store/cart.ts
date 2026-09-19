import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The cart — the only genuinely client-owned state in the app (ADR 004).
 *
 * It stores **item ids and quantities only**. Never prices, never names, never a
 * total. `place_order` re-reads every price from the database and ignores anything
 * the client could have sent, so a price here would be decoration at best and a lie
 * at worst once the canteen changes it.
 *
 * It persists because a hostel phone kills backgrounded apps, and losing a
 * half-built order to that is infuriating.
 */

export type CartLine = { itemId: string; quantity: number };

export type CartState = {
  /** A cart belongs to exactly one canteen; the database refuses mixed orders. */
  canteenId: string | null;
  lines: CartLine[];

  add: (canteenId: string, itemId: string, quantity?: number) => void;
  setQuantity: (itemId: string, quantity: number) => void;
  remove: (itemId: string) => void;
  clear: () => void;

  /** Replaces whatever is there with a single item from a different canteen. */
  replaceWith: (canteenId: string, itemId: string, quantity?: number) => void;

  quantityOf: (itemId: string) => number;
  totalUnits: () => number;
  /** True when adding this canteen's item would mix canteens. */
  wouldConflict: (canteenId: string) => boolean;
};

const empty = { canteenId: null, lines: [] as CartLine[] };

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      ...empty,

      add: (canteenId, itemId, quantity = 1) =>
        set((state) => {
          // Callers are expected to have resolved a conflict already; refusing here
          // rather than silently dropping the old cart keeps the bug visible.
          if (state.canteenId && state.canteenId !== canteenId) return state;

          const existing = state.lines.find((line) => line.itemId === itemId);
          const lines = existing
            ? state.lines.map((line) =>
                line.itemId === itemId ? { ...line, quantity: line.quantity + quantity } : line,
              )
            : [...state.lines, { itemId, quantity }];
          return { canteenId, lines };
        }),

      setQuantity: (itemId, quantity) =>
        set((state) => {
          if (quantity <= 0) {
            const lines = state.lines.filter((line) => line.itemId !== itemId);
            // An empty cart has no canteen, so the next item can come from anywhere.
            return lines.length === 0 ? empty : { ...state, lines };
          }
          return {
            ...state,
            lines: state.lines.map((line) =>
              line.itemId === itemId ? { ...line, quantity } : line,
            ),
          };
        }),

      remove: (itemId) => get().setQuantity(itemId, 0),

      clear: () => set(empty),

      replaceWith: (canteenId, itemId, quantity = 1) =>
        set({ canteenId, lines: [{ itemId, quantity }] }),

      quantityOf: (itemId) => get().lines.find((line) => line.itemId === itemId)?.quantity ?? 0,

      totalUnits: () => get().lines.reduce((sum, line) => sum + line.quantity, 0),

      wouldConflict: (canteenId) => {
        const current = get().canteenId;
        return current !== null && current !== canteenId && get().lines.length > 0;
      },
    }),
    {
      name: 'campuseats.cart',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the data. Rehydrating functions would overwrite the live ones.
      partialize: (state) => ({ canteenId: state.canteenId, lines: state.lines }),
    },
  ),
);
