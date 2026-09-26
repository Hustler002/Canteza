import { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { MenuItem } from '@canteza/api';
import { BRAND, estimatedMinutes, formatPaise, toAppError } from '@canteza/shared';
import {
  useCanteen,
  useCanteenStats,
  useFavorites,
  useMenu,
  useToggleFavorite,
} from '../../../src/lib/queries';
import { useIdentity } from '../../../src/lib/session';
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
import {
  AppBar,
  Price,
  QtyStepper,
  Rating,
  Thumb,
  VegMark,
} from '../../../src/components/patterns';
import { useTheme } from '../../../src/theme';

export default function CanteenMenu() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canteenId = id ?? '';
  const canteen = useCanteen(canteenId);
  const menu = useMenu(canteenId);
  const cartUnits = useCart((state) => state.totalUnits());
  const cartCanteen = useCart((state) => state.canteenId);
  const cartLines = useCart((state) => state.lines);
  const favourites = useFavorites();
  const allStats = useCanteenStats();

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

  const stats = (allStats.data ?? []).find((row) => row.canteen_id === canteenId);
  const open = Boolean(canteen.data.is_open) && Boolean(canteen.data.is_accepting_orders);
  const showCartBar = cartUnits > 0 && cartCanteen === canteenId;
  const favouriteIds = new Set((favourites.data ?? []).map((row) => row.menu_item_id));

  /*
   * A running subtotal for the cart bar, priced from the menu this screen already
   * holds. The cart itself still stores only ids and quantities (rule 17) -- this is
   * derived from server data at render time, never stored, and `place_order` re-reads
   * every price anyway. It is a preview of the bill, not the bill.
   */
  const priceById = new Map((menu.data ?? []).map((item) => [item.id, item.price_paise]));
  const subtotalPaise = cartLines.reduce(
    (sum, line) => sum + (priceById.get(line.itemId) ?? 0) * line.quantity,
    0,
  );

  return (
    <Screen
      padded={false}
      footer={
        showCartBar ? (
          <Button
            label={`${cartUnits} item${cartUnits > 1 ? 's' : ''} · ${formatPaise(subtotalPaise)}   View cart →`}
            onPress={() => router.push('/cart')}
          />
        ) : undefined
      }
    >
      <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.sm }}>
        <AppBar
          title={canteen.data.name ?? 'Canteen'}
          subtitle={
            open
              ? // The same quote the home card gave, carried through so the number
                // does not change between choosing a canteen and ordering from it.
                `~${estimatedMinutes(stats?.median_prep_minutes, stats?.prep_sample_size)} min${
                  canteen.data.min_order_paise
                    ? ` · minimum ${formatPaise(canteen.data.min_order_paise)}`
                    : ''
                }`
              : 'Closed — browse only'
          }
          onBack={() => router.back()}
          right={<Rating average={stats?.avg_food_rating} count={stats?.review_count} />}
        />
      </View>

      <FlatList
        data={menu.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
        ListHeaderComponent={
          canteen.data.description || !open ? (
            <View style={{ gap: t.space.sm, marginBottom: t.space.xs }}>
              {canteen.data.description ? <Body muted>{canteen.data.description}</Body> : null}
              {!open ? <Badge label="Closed — you can browse but not order" tone="danger" /> : null}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <MenuRow
            item={item}
            canteenId={canteenId}
            canOrder={open}
            favourite={favouriteIds.has(item.id)}
          />
        )}
        ListEmptyComponent={
          <EmptyState title="Nothing on the menu" body="This canteen has not added items yet." />
        }
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

function MenuRow({
  item,
  canteenId,
  canOrder,
  favourite,
}: {
  item: MenuItem;
  canteenId: string;
  canOrder: boolean;
  favourite: boolean;
}) {
  const t = useTheme();
  const identity = useIdentity();
  const [busy, setBusy] = useState(false);
  const quantity = useCart((state) => state.quantityOf(item.id));
  const { add, setQuantity, wouldConflict, replaceWith } = useCart();
  const toggleFavourite = useToggleFavorite(identity.userId);

  const soldOut = !item.is_available;

  function onAdd() {
    // The database refuses a cart that mixes canteens, so ask before discarding
    // rather than letting checkout fail with CART_MIXED_CANTEENS.
    if (wouldConflict(canteenId)) {
      setBusy(true);
      Alert.alert(
        'Start a new cart?',
        `Your cart has items from another canteen. ${BRAND.name} can only deliver from one canteen at a time.`,
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
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.space.md }}>
        {/*
         * The photo, only if there is one. `Thumb` renders nothing without a URL and
         * this row reserves no space for it, so a menu with no images is a clean list
         * of names rather than a column of empty squares — and the day a counter adds
         * a photo, it simply appears and the text reflows beside it.
         */}
        <Thumb name={item.name} uri={item.image_url} size={64} />

        <View style={{ flex: 1, gap: t.space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            {/* Not an emoji: a red dot and a green dot are the same dot to a
             * red-green colourblind student, so the mark carries a label too. */}
            <VegMark veg={item.is_veg} />
            <Heading level="heading">{item.name}</Heading>
          </View>

          {item.description ? <Body muted>{item.description}</Body> : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: t.space.md,
              marginTop: t.space.xs,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              <Price value={formatPaise(item.price_paise)} />
              {/*
               * A favourite is per dish, not per canteen: `favorites` is keyed
               * (student_id, menu_item_id), and what a student wants again is the
               * biryani rather than the counter that happens to sell it.
               */}
              <Pressable
                onPress={() => toggleFavourite.mutate({ menuItemId: item.id, on: !favourite })}
                accessibilityRole="switch"
                accessibilityState={{ checked: favourite }}
                accessibilityLabel={
                  favourite
                    ? `Remove ${item.name} from favourites`
                    : `Add ${item.name} to favourites`
                }
                hitSlop={t.hitSlop}
              >
                <Text
                  style={{ fontSize: 18, color: favourite ? t.color.danger : t.color.textMuted }}
                >
                  {favourite ? '♥' : '♡'}
                </Text>
              </Pressable>
            </View>

            {soldOut ? (
              <Badge label="Sold out" tone="neutral" />
            ) : (
              <QtyStepper
                quantity={quantity}
                onAdd={quantity === 0 ? onAdd : () => setQuantity(item.id, quantity + 1)}
                onRemove={() => setQuantity(item.id, quantity - 1)}
                disabled={!canOrder || busy}
                accessibilityName={item.name}
              />
            )}
          </View>
        </View>
      </View>
    </Card>
  );
}
