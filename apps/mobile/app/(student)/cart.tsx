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
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormError,
  Loading,
  Overline,
  Screen,
} from '../../src/components/ui';
import { MoneyRow } from '../../src/components/order';
import {
  AppBar,
  CardTitle,
  Divider,
  Icon,
  Price,
  QtyStepper,
  Thumb,
  VegMark,
} from '../../src/components/patterns';
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
        <EmptyState
          emoji="🛒"
          title="Your cart is waiting"
          body="Pick a canteen and add something to it."
          action={{ label: 'Browse canteens', onPress: () => router.replace('/') }}
        />
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
            label="Proceed to checkout"
            trailing={`${formatPaise(totals.totalPaise)} ›`}
            size="lg"
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
            style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}
          >
            <Icon name="trash-outline" size={16} color={t.color.danger} />
            <Text style={[t.font.label, { color: t.color.danger }]}>Clear</Text>
          </Pressable>
        }
      />

      <Card>
        <CardTitle
          icon="storefront-outline"
          title={canteen.data?.name ?? 'Your items'}
          subtitle={itemCountLabel(lines.reduce((sum, line) => sum + line.quantity, 0))}
        />
        <Divider dashed />
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                {item ? <VegMark veg={item.is_veg} /> : null}
                <Text style={[t.font.bodyStrong, { color: t.color.text, flexShrink: 1 }]}>
                  {item ? item.name : 'No longer on the menu'}
                </Text>
              </View>
              {item && !item.is_available ? (
                <Badge label="Sold out" tone="danger" />
              ) : item ? (
                <Price value={formatPaise(item.price_paise)} tone="muted" />
              ) : (
                <Text style={[t.font.caption, { color: t.color.danger }]}>
                  Remove it to continue
                </Text>
              )}
            </View>

            <View style={{ alignItems: 'flex-end', gap: t.space.sm }}>
              <QtyStepper
                quantity={line.quantity}
                onAdd={() => setQuantity(line.itemId, line.quantity + 1)}
                onRemove={() => setQuantity(line.itemId, line.quantity - 1)}
                accessibilityName={item ? item.name : 'this item'}
              />
              {item ? <Price value={formatPaise(item.price_paise * line.quantity)} /> : null}
            </View>
          </View>
        ))}
        <Divider dashed />
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}
        >
          <Icon name="add-circle-outline" size={18} color={t.color.primary} />
          <Text style={[t.font.label, { color: t.color.primary }]}>Add more items</Text>
        </Pressable>
      </Card>

      <Card>
        <Overline>Bill details</Overline>
        <MoneyRow label="Item total" amountPaise={totals.subtotalPaise} />
        <MoneyRow label="Delivery to your room" amountPaise={totals.deliveryFeePaise} />
        <Divider dashed />
        <MoneyRow label="To pay" amountPaise={totals.totalPaise} strong />
      </Card>

      {/*
       * No surprise fees (§9). The platform fee is NOT a line here because it is
       * not an extra charge -- it is the slice of the delivery fee above that
       * Canteza keeps, so listing it would double-count it on the student's bill.
       */}
      <View
        style={{
          flexDirection: 'row',
          gap: t.space.sm,
          padding: t.space.md,
          borderRadius: t.radius.md,
          backgroundColor: t.color.successSoft,
        }}
      >
        <Icon name="shield-checkmark-outline" size={18} color={t.color.success} />
        <Text style={[t.font.caption, { color: t.color.text, flex: 1 }]}>
          Nothing else is added at checkout. The canteen keeps every rupee of the food;{' '}
          {formatPaise(PLATFORM_DEFAULTS.platformFeePaise)} of the delivery fee keeps {BRAND.name}{' '}
          running.
        </Text>
      </View>
    </Screen>
  );
}

function itemCountLabel(units: number): string {
  return `${units} item${units === 1 ? '' : 's'}`;
}
