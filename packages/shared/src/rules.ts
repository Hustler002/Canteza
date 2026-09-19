import { PLATFORM_DEFAULTS } from './config';
import { AppError, ERROR_CODES } from './errors';
import type { Paise } from './money';
import type { CartLine } from './pricing';

/**
 * Pre-submit validation, mirrored by the `place_order` Postgres function.
 *
 * The SQL copy is authoritative — it runs inside the same transaction that writes the
 * order, so it cannot be raced. This copy exists so the checkout screen can disable the
 * button and explain why, instead of letting the user submit into a rejection.
 */

export type CanteenSnapshot = {
  id: string;
  isOpen: boolean;
  isAcceptingOrders: boolean;
  minOrderPaise: Paise;
};

export type MenuItemSnapshot = {
  id: string;
  canteenId: string;
  isAvailable: boolean;
};

export type OrderPlacementInput = {
  canteen: CanteenSnapshot;
  lines: readonly CartLine[];
  items: ReadonlyMap<string, MenuItemSnapshot>;
  subtotalPaise: Paise;
};

export function validateOrderPlacement(input: OrderPlacementInput): void {
  const { canteen, lines, items, subtotalPaise } = input;

  if (lines.length === 0) {
    throw new AppError(ERROR_CODES.CART_EMPTY);
  }
  if (!canteen.isOpen || !canteen.isAcceptingOrders) {
    throw new AppError(ERROR_CODES.CANTEEN_CLOSED, { canteenId: canteen.id });
  }

  let totalUnits = 0;
  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item || !item.isAvailable) {
      throw new AppError(ERROR_CODES.ITEM_UNAVAILABLE, { itemId: line.itemId });
    }
    if (item.canteenId !== canteen.id) {
      throw new AppError(ERROR_CODES.CART_MIXED_CANTEENS, { itemId: line.itemId });
    }
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > PLATFORM_DEFAULTS.maxQuantityPerItem
    ) {
      throw new AppError(ERROR_CODES.INVALID_QUANTITY, {
        itemId: line.itemId,
        quantity: line.quantity,
      });
    }
    totalUnits += line.quantity;
  }

  if (totalUnits > PLATFORM_DEFAULTS.maxItemsPerOrder) {
    throw new AppError(ERROR_CODES.INVALID_QUANTITY, { totalUnits });
  }
  if (subtotalPaise < canteen.minOrderPaise) {
    throw new AppError(ERROR_CODES.BELOW_MINIMUM_ORDER, {
      subtotalPaise,
      minOrderPaise: canteen.minOrderPaise,
    });
  }
}

/** Non-throwing wrapper for rendering: returns the blocking error, or null if placeable. */
export function checkOrderPlacement(input: OrderPlacementInput): AppError | null {
  try {
    validateOrderPlacement(input);
    return null;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}
