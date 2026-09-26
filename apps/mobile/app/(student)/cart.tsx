import { Pressable, Text, View } from 'react-native';
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
  Badge,
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormError,
  Loading,
  Screen,
} from '../../src/components/ui';
import { MoneyRow } from '../../src/components/order';
import { AppBar, Price, QtyStepper, Thumb } from '../../src/components/patterns';
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
        <AppBar title="Your cart" onBack={() => router.back()} />
        <EmptyState title="Your cart is waiting" body="Pick a canteen and add something to it." />
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
    <Screen
      scroll
      footer={
        <>
          <FormError message={blocker ? blocker.userMessage : null} />
          {/*
           * The total lives on the button itself, so it is readable at the moment of
           * the decision rather than needing a scroll back up to check (§10).
           */}
          <Button
            label={`Checkout · ${formatPaise(totals.totalPaise)}`}
            onPress={() => router.push('/checkout')}
            disabled={blocker !== null}
          />
        </>
      }
    >
      <AppBar
        title="Your cart"
        subtitle={canteen.data?.name ?? undefined}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={clear}
            accessibilityRole="button"
            accessibilityLabel="Clear cart"
            hitSlop={t.hitSlop}
          >
            <Text style={[t.font.label, { color: t.color.danger }]}>Clear</Text>
          </Pressable>
        }
      />

      <Card>
        {resolved.map(({ line, item }, index) => (
          <View
            key={line.itemId}
            style={{
              gap: t.space.md,
              flexDirection: 'row',
              alignItems: 'center',
              // A rule between lines rather than around each: the card is already
              // the container, so a second border per row would be noise.
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: t.color.border,
              paddingTop: index === 0 ? 0 : t.space.md,
            }}
          >
            {item ? <Thumb name={item.name} uri={item.image_url} size={48} /> : null}

            <View style={{ flex: 1, gap: t.space.xs }}>
              <Body>{item ? item.name : 'No longer on the menu'}</Body>
              {item && !item.is_available ? (
                <Badge label="Sold out" tone="danger" />
              ) : item ? (
                <Price value={formatPaise(item.price_paise)} tone="muted" />
              ) : (
                <Body muted>Remove it to continue</Body>
              )}
            </View>

            <View style={{ alignItems: 'flex-end', gap: t.space.sm }}>
              {item ? <Price value={formatPaise(item.price_paise * line.quantity)} /> : null}
              <QtyStepper
                quantity={line.quantity}
                onAdd={() => setQuantity(line.itemId, line.quantity + 1)}
                onRemove={() => setQuantity(line.itemId, line.quantity - 1)}
                accessibilityName={item ? item.name : 'this item'}
              />
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <MoneyRow label="Subtotal" amountPaise={totals.subtotalPaise} />
        <MoneyRow label="Delivery" amountPaise={totals.deliveryFeePaise} />
        <MoneyRow label="Total" amountPaise={totals.totalPaise} strong />
        {/*
         * No surprise fees (§9). The platform fee is NOT a line here because it is
         * not an extra charge -- it is the slice of the delivery fee above that
         * Canteza keeps, so listing it would double-count it on the student's bill.
         */}
        <Body muted>
          Nothing else is added at checkout. The canteen keeps every rupee of the food;{' '}
          {formatPaise(PLATFORM_DEFAULTS.platformFeePaise)} of the delivery fee keeps {BRAND.name}{' '}
          running.
        </Body>
      </Card>
    </Screen>
  );
}
