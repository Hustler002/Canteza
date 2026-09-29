import { useState, type ReactElement, type ReactNode } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
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
import { confirm } from '../../../src/lib/dialog';
import { useIdentity } from '../../../src/lib/session';
import { useCart } from '../../../src/store/cart';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  useColumn,
} from '../../../src/components/ui';
import {
  AppBar,
  Chip,
  Fact,
  Icon,
  Price,
  QtyStepper,
  Rating,
  Thumb,
  VegMark,
} from '../../../src/components/patterns';
import { FadeIn } from '../../../src/components/motion';
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
  // A view filter only: the menu, the cart and the prices are untouched by it.
  const [vegOnly, setVegOnly] = useState(false);

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
    return (
      <EmptyState
        emoji="🏚️"
        title="Canteen not found"
        body="It may have been closed down."
        action={{ label: 'Back to canteens', onPress: () => router.replace('/') }}
      />
    );
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

  const items = (menu.data ?? []).filter((item) => !vegOnly || item.is_veg);
  const hasVeg = (menu.data ?? []).some((item) => item.is_veg);

  return (
    <Screen
      padded={false}
      footer={
        showCartBar ? (
          <Button
            icon="bag-handle"
            label={`${cartUnits} item${cartUnits > 1 ? 's' : ''} · ${formatPaise(subtotalPaise)}`}
            trailing="View cart ›"
            size="lg"
            onPress={() => router.push('/cart')}
          />
        ) : undefined
      }
    >
      <MenuList
        items={items}
        header={
          <View style={{ gap: t.space.lg, marginBottom: t.space.md }}>
            <AppBar onBack={() => router.back()} />
            <CanteenHero
              name={canteen.data.name ?? 'Canteen'}
              description={canteen.data.description}
              open={open}
              // The same quote the home card gave, carried through so the number
              // does not change between choosing a canteen and ordering from it.
              eta={
                open ? estimatedMinutes(stats?.median_prep_minutes, stats?.prep_sample_size) : null
              }
              minOrderPaise={canteen.data.min_order_paise}
              opensAt={canteen.data.opens_at}
              closesAt={canteen.data.closes_at}
              rating={<Rating average={stats?.avg_food_rating} count={stats?.review_count} />}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              {hasVeg ? (
                <Chip
                  icon="leaf"
                  label="Veg only"
                  selected={vegOnly}
                  onPress={() => setVegOnly(!vegOnly)}
                />
              ) : null}
              <Text style={[t.font.caption, { color: t.color.textMuted }]}>
                {items.length} dish{items.length === 1 ? '' : 'es'}
              </Text>
            </View>
          </View>
        }
        renderRow={(item) => (
          <MenuRow
            item={item}
            canteenId={canteenId}
            canOrder={open}
            favourite={favouriteIds.has(item.id)}
          />
        )}
        empty={
          vegOnly ? (
            <EmptyState
              emoji="🥗"
              title="No veg dishes here"
              body="Turn off “Veg only” to see the whole menu."
              action={{ label: 'Show everything', onPress: () => setVegOnly(false) }}
            />
          ) : (
            <EmptyState
              emoji="📋"
              title="Nothing on the menu"
              body="This canteen has not added items yet."
            />
          )
        }
      />
    </Screen>
  );
}

/**
 * The menu as one continuous card, like a printed menu: rows separated by hairlines
 * rather than each dish floating in its own box, which at twenty-eight dishes is a
 * wall of boxes. Its own component so it can read the page column from `Screen`.
 */
function MenuList({
  items,
  header,
  renderRow,
  empty,
}: {
  items: MenuItem[];
  header: ReactElement;
  renderRow: (item: MenuItem) => ReactElement;
  empty: ReactElement;
}) {
  const t = useTheme();
  const column = useColumn();
  const last = items.length - 1;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[column, { padding: t.space.lg, paddingTop: t.space.md }]}
      ListHeaderComponent={header}
      renderItem={({ item, index }) => (
        <FadeIn index={index}>
          <View
            style={[
              {
                backgroundColor: t.color.surface,
                paddingHorizontal: t.space.lg,
                paddingVertical: t.space.lg,
                borderTopLeftRadius: index === 0 ? t.radius.lg : 0,
                borderTopRightRadius: index === 0 ? t.radius.lg : 0,
                borderBottomLeftRadius: index === last ? t.radius.lg : 0,
                borderBottomRightRadius: index === last ? t.radius.lg : 0,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: t.color.border,
                borderStyle: 'dashed',
              },
              index === 0 ? t.elevation.card : null,
            ]}
          >
            {renderRow(item)}
          </View>
        </FadeIn>
      )}
      ListEmptyComponent={empty}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** The canteen's own card at the top of its menu: who it is, how good, how long, when. */
function CanteenHero({
  name,
  description,
  open,
  eta,
  minOrderPaise,
  opensAt,
  closesAt,
  rating,
}: {
  name: string;
  description: string | null;
  open: boolean;
  eta: number | null;
  minOrderPaise: number | null;
  opensAt: string | null;
  closesAt: string | null;
  rating: ReactNode;
}) {
  const t = useTheme();
  return (
    <FadeIn>
      <Card style={{ padding: t.space.xl, gap: t.space.md }}>
        <View style={{ flexDirection: 'row', gap: t.space.lg, alignItems: 'center' }}>
          <Thumb name={name} size={64} fallback="initial" />
          <View style={{ flex: 1, gap: t.space.xs }}>
            <Text style={[t.font.title, { color: t.color.text, fontSize: 24, lineHeight: 30 }]}>
              {name}
            </Text>
            {rating}
          </View>
        </View>
        {description ? (
          <Text style={[t.font.body, { color: t.color.textMuted }]}>{description}</Text>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: t.space.lg,
            paddingTop: t.space.md,
            borderTopWidth: 1,
            borderTopColor: t.color.border,
            borderStyle: 'dashed',
          }}
        >
          {eta !== null ? (
            <Fact icon="time-outline" label={`${eta} min to your room`} strong />
          ) : null}
          <Fact
            icon="calendar-clear-outline"
            label={`${opensAt?.slice(0, 5) ?? ''}–${closesAt?.slice(0, 5) ?? ''}`}
          />
          {minOrderPaise ? (
            <Fact icon="wallet-outline" label={`${formatPaise(minOrderPaise)} minimum`} />
          ) : null}
        </View>
        {!open ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.space.sm,
              padding: t.space.md,
              borderRadius: t.radius.md,
              backgroundColor: t.color.warningSoft,
            }}
          >
            <Icon name="moon-outline" size={18} color={t.color.warning} />
            <Text style={[t.font.label, { color: t.color.warning, flex: 1 }]}>
              Closed right now — you can browse, but not order.
            </Text>
          </View>
        ) : null}
      </Card>
    </FadeIn>
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
      confirm({
        title: 'Start a new cart?',
        message: `Your cart has items from another canteen. ${BRAND.name} can only deliver from one canteen at a time.`,
        cancelLabel: 'Keep my cart',
        confirmLabel: 'Start new cart',
        destructive: true,
        onConfirm: () => {
          replaceWith(canteenId, item.id);
          setBusy(false);
        },
        onCancel: () => setBusy(false),
      });
      return;
    }
    add(canteenId, item.id);
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.lg,
        opacity: soldOut ? 0.55 : 1,
      }}
    >
      <View style={{ flex: 1, gap: t.space.xs }}>
        {/* Not an emoji: a red dot and a green dot are the same dot to a
         * red-green colourblind student, so the mark carries a label too. */}
        <VegMark veg={item.is_veg} />
        <Text style={[t.font.heading, { color: t.color.text }]}>{item.name}</Text>
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
              favourite ? `Remove ${item.name} from favourites` : `Add ${item.name} to favourites`
            }
            hitSlop={t.hitSlop}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.85 : 1 }] })}
          >
            <Icon
              name={favourite ? 'heart' : 'heart-outline'}
              size={20}
              color={favourite ? t.color.danger : t.color.textMuted}
            />
          </Pressable>
        </View>
        {item.description ? (
          <Text style={[t.font.caption, { color: t.color.textMuted }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
      </View>

      {/*
       * The photo, only if there is one. `Thumb` renders nothing without a URL and
       * this row reserves no space for it, so a menu with no images is a clean list
       * of names rather than a column of empty squares — and the day a counter adds
       * a photo, it simply appears with the button tucked under it.
       */}
      <View style={{ alignItems: 'center', gap: t.space.sm }}>
        <Thumb name={item.name} uri={item.image_url} size={96} />
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
  );
}
