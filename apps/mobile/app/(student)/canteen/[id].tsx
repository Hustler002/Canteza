import { useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { MenuItem } from '@campuseats/api';
import { formatPaise, toAppError } from '@campuseats/shared';
import { useCanteen, useMenu } from '../../../src/lib/queries';
import { useCart } from '../../../src/store/cart';
import {
  Badge,
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Heading,
  Loading,
  Screen,
} from '../../../src/components/ui';
import { useTheme } from '../../../src/theme';

export default function CanteenMenu() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canteenId = id ?? '';
  const canteen = useCanteen(canteenId);
  const menu = useMenu(canteenId);
  const cartUnits = useCart((state) => state.totalUnits());
  const cartCanteen = useCart((state) => state.canteenId);

  if (canteen.isLoading || menu.isLoading) return <Loading label="Loading menu…" />;
  if (menu.isError) {
    return (
      <ErrorState
        message={toAppError(menu.error).userMessage}
        onRetry={() => void menu.refetch()}
      />
    );
  }
  if (!canteen.data) {
    return <EmptyState title="Canteen not found" body="It may have been closed down." />;
  }

  const open = Boolean(canteen.data.is_open) && Boolean(canteen.data.is_accepting_orders);
  const showCartBar = cartUnits > 0 && cartCanteen === canteenId;

  return (
    <Screen padded={false}>
      <FlatList
        data={menu.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
        ListHeaderComponent={
          <View style={{ gap: t.space.sm, marginBottom: t.space.sm }}>
            <Button label="← Back" variant="secondary" onPress={() => router.back()} />
            <Heading level="display">{canteen.data.name}</Heading>
            <Body muted>{canteen.data.description}</Body>
            {!open ? (
              <Badge label="Closed — you can browse but not order" tone="danger" />
            ) : canteen.data.min_order_paise ? (
              <Badge
                label={`Minimum order ${formatPaise(canteen.data.min_order_paise)}`}
                tone="neutral"
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => <MenuRow item={item} canteenId={canteenId} canOrder={open} />}
        ListEmptyComponent={
          <EmptyState title="Nothing on the menu" body="This canteen has not added items yet." />
        }
      />

      {showCartBar ? (
        <View style={{ padding: t.space.lg, paddingTop: 0 }}>
          <Button
            label={`Review cart · ${cartUnits} item${cartUnits > 1 ? 's' : ''}`}
            onPress={() => router.push('/cart')}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function MenuRow({
  item,
  canteenId,
  canOrder,
}: {
  item: MenuItem;
  canteenId: string;
  canOrder: boolean;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const quantity = useCart((state) => state.quantityOf(item.id));
  const { add, setQuantity, wouldConflict, replaceWith } = useCart();

  const soldOut = !item.is_available;

  function onAdd() {
    // The database refuses a cart that mixes canteens, so ask before discarding
    // rather than letting checkout fail with CART_MIXED_CANTEENS.
    if (wouldConflict(canteenId)) {
      setBusy(true);
      Alert.alert(
        'Start a new cart?',
        'Your cart has items from another canteen. CampusEats can only deliver from one canteen at a time.',
        [
          { text: 'Keep my cart', style: 'cancel', onPress: () => setBusy(false) },
          {
            text: 'Start new cart',
            style: 'destructive',
            onPress: () => {
              replaceWith(canteenId, item.id);
              setBusy(false);
            },
          },
        ],
      );
      return;
    }
    add(canteenId, item.id);
  }

  return (
    <Card style={{ opacity: soldOut ? 0.55 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
        <View style={{ flex: 1, gap: t.space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <Body>{item.is_veg ? '🟢' : '🔴'}</Body>
            <Heading level="heading">{item.name}</Heading>
          </View>
          {item.description ? <Body muted>{item.description}</Body> : null}
          <Body>{formatPaise(item.price_paise)}</Body>
        </View>

        <View style={{ justifyContent: 'center', minWidth: 104 }}>
          {soldOut ? (
            <Badge label="Sold out" tone="neutral" />
          ) : quantity === 0 ? (
            <Button label="Add" onPress={onAdd} disabled={!canOrder || busy} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
              <Stepper label="−" onPress={() => setQuantity(item.id, quantity - 1)} />
              <Body>{quantity}</Body>
              <Stepper label="+" onPress={() => setQuantity(item.id, quantity + 1)} />
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Increase quantity' : 'Decrease quantity'}
      hitSlop={t.hitSlop}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: t.radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.color.primarySoft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Body>{label}</Body>
    </Pressable>
  );
}
