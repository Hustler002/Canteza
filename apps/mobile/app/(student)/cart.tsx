import { View } from 'react-native';
import { router } from 'expo-router';
import {
  BRAND,
  checkOrderPlacement,
  computeTotals,
  formatPaise,
  PLATFORM_DEFAULTS,
  toAppError,
  type CartLine,
  type MenuItemSnapshot,
} from '@canteza/shared';
import { useCanteen, useMenu } from '../../src/lib/queries';
import { useCart } from '../../src/store/cart';
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormError,
  Heading,
  Loading,
  Screen,
} from '../../src/components/ui';
import { MoneyRow } from '../../src/components/order';
import { useTheme } from '../../src/theme';

/**
 * Cart review.
 *
 * Prices are resolved from the live menu at render time — the cart itself stores no
 * money. The total shown here is a preview computed by the same `computeTotals` the
 * server mirrors; the authoritative figure is whatever `place_order` writes.
 */
export default function CartScreen() {
  const t = useTheme();
  const canteenId = useCart((state) => state.canteenId);
  const lines = useCart((state) => state.lines);
  const { setQuantity, clear } = useCart();

  const canteen = useCanteen(canteenId ?? '');
  const menu = useMenu(canteenId ?? '');

  if (!canteenId || lines.length === 0) {
    return (
      <Screen>
        <Button label="← Back" variant="secondary" onPress={() => router.back()} />
        <EmptyState title="Your cart is empty" body="Pick a canteen and add something." />
      </Screen>
    );
  }

  if (canteen.isLoading || menu.isLoading) return <Loading label="Checking prices…" />;
  if (menu.isError) {
    return (
      <ErrorState
        message={toAppError(menu.error).userMessage}
        onRetry={() => void menu.refetch()}
      />
    );
  }

  const menuById = new Map((menu.data ?? []).map((item) => [item.id, item]));

  // An item can vanish from the menu while it sits in a cart. Dropping it silently
  // would change the order behind the student's back, so it is shown and flagged.
  const resolved = lines.map((line) => ({ line, item: menuById.get(line.itemId) }));
  const priced: CartLine[] = resolved
    .filter((entry) => entry.item)
    .map((entry) => ({
      itemId: entry.line.itemId,
      unitPricePaise: entry.item!.price_paise,
      quantity: entry.line.quantity,
    }));

  const totals = computeTotals({
    lines: priced,
    deliveryFeePaise: PLATFORM_DEFAULTS.deliveryFeePaise,
  });

  const snapshots = new Map<string, MenuItemSnapshot>(
    (menu.data ?? []).map((item) => [
      item.id,
      { id: item.id, canteenId: item.canteen_id, isAvailable: item.is_available },
    ]),
  );

  // The same rules the SQL enforces, run early so the button explains itself
  // instead of the student submitting into a rejection.
  const blocker = canteen.data
    ? checkOrderPlacement({
        canteen: {
          id: canteenId,
          isOpen: Boolean(canteen.data.is_open),
          isAcceptingOrders: Boolean(canteen.data.is_accepting_orders),
          minOrderPaise: canteen.data.min_order_paise ?? 0,
        },
        lines: priced,
        items: snapshots,
        subtotalPaise: totals.subtotalPaise,
      })
    : null;

  return (
    <Screen scroll>
      <Button label="← Back" variant="secondary" onPress={() => router.back()} />

      <View style={{ gap: t.space.xs }}>
        <Heading level="display">Your cart</Heading>
        <Body muted>{canteen.data?.name}</Body>
      </View>

      <Card>
        {resolved.map(({ line, item }) => (
          <View key={line.itemId} style={{ gap: t.space.sm }}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}
            >
              <View style={{ flex: 1 }}>
                <Body>{item ? item.name : 'Item no longer available'}</Body>
                {item && !item.is_available ? <Body muted>Sold out</Body> : null}
              </View>
              <Body muted>{item ? formatPaise(item.price_paise * line.quantity) : '—'}</Body>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              <Button
                label="−"
                variant="secondary"
                onPress={() => setQuantity(line.itemId, line.quantity - 1)}
              />
              <Body>{line.quantity}</Body>
              <Button
                label="+"
                variant="secondary"
                onPress={() => setQuantity(line.itemId, line.quantity + 1)}
              />
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <MoneyRow label="Subtotal" amountPaise={totals.subtotalPaise} />
        <MoneyRow label="Delivery" amountPaise={totals.deliveryFeePaise} />
        <MoneyRow label="Total" amountPaise={totals.totalPaise} strong />
        <Body muted>
          The canteen keeps every rupee of the food.{' '}
          {formatPaise(PLATFORM_DEFAULTS.platformFeePaise)} of the delivery fee keeps {BRAND.name}
          running.
        </Body>
      </Card>

      <FormError message={blocker ? blocker.userMessage : null} />

      <Button
        label="Continue to checkout"
        onPress={() => router.push('/checkout')}
        disabled={blocker !== null}
      />
      <Button label="Clear cart" variant="secondary" onPress={clear} />
    </Screen>
  );
}
