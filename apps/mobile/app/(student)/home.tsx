import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatPaise, toAppError } from '@canteza/shared';
import type { Canteen } from '@canteza/api';
import {
  useActiveOrder,
  useCanteens,
  useFavorites,
  useHostels,
  useMenuSearch,
  useOrdersRealtime,
  orderFilters,
} from '../../src/lib/queries';
import { useIdentity } from '../../src/lib/session';
import { useCart } from '../../src/store/cart';
import {
  Badge,
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Heading,
  Screen,
} from '../../src/components/ui';
import { StatusPill } from '../../src/components/order';
import {
  AppBar,
  IconButton,
  Price,
  SectionHeader,
  SkeletonList,
  Thumb,
  VegMark,
} from '../../src/components/patterns';
import { useTheme } from '../../src/theme';

export default function StudentHome() {
  const t = useTheme();
  const identity = useIdentity();
  const canteens = useCanteens();
  const activeOrder = useActiveOrder();
  const cartUnits = useCart((state) => state.totalUnits());
  const cartCanteen = useCart((state) => state.canteenId);
  const favourites = useFavorites();
  const hostels = useHostels();
  const [term, setTerm] = useState('');

  /*
   * Where this order is going, said up front rather than discovered at checkout.
   * The profile stores the address all-or-nothing, so either all three parts are
   * there or none are -- there is no half-filled line to render.
   */
  const profile = identity.profile;
  const hostelName = (hostels.data ?? []).find(
    (hostel) => hostel.id === profile.default_hostel_id,
  )?.name;
  const deliveryLine =
    hostelName && profile.default_block && profile.default_room
      ? `${hostelName} · Block ${profile.default_block} · Room ${profile.default_room}`
      : 'Add your room at checkout';

  // Live status without polling: an event invalidates, the query refetches.
  useOrdersRealtime(orderFilters.forStudent(identity.userId));

  // A skeleton rather than a spinner: it says "a list of canteens is arriving",
  // which reads as fast, where a centred spinner reads as stalled.
  if (canteens.isLoading) {
    return (
      <Screen>
        <SkeletonList rows={4} />
      </Screen>
    );
  }
  if (canteens.isError) {
    return (
      <ErrorState
        message={toAppError(canteens.error).userMessage}
        onRetry={() => void canteens.refetch()}
      />
    );
  }

  const order = activeOrder.data;
  const searching = term.trim().length >= 2;
  const canteenNameById = new Map(
    (canteens.data ?? []).map((canteen) => [canteen.id, canteen.name ?? 'Canteen']),
  );

  return (
    <Screen
      padded={false}
      footer={
        cartUnits > 0 && cartCanteen ? (
          <Button
            label={`${cartUnits} item${cartUnits > 1 ? 's' : ''} in cart   View cart →`}
            onPress={() => router.push('/cart')}
          />
        ) : undefined
      }
    >
      <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.sm, gap: t.space.md }}>
        <AppBar
          title={`Hi ${identity.profile.full_name?.split(' ')[0] || 'there'}`}
          subtitle={deliveryLine}
          right={
            <IconButton glyph="☰" label="Your orders" onPress={() => router.push('/my-orders')} />
          }
        />

        {/*
         * Search is the first thing under the greeting because a hungry student
         * usually already knows what they want -- browsing is the fallback, not the
         * main path (§6). Two characters is the floor, so the query does not fire on
         * the way to a word.
         */}
        <SearchBar value={term} onChange={setTerm} />
      </View>

      {searching ? (
        <DishResults
          term={term}
          canteenNameById={canteenNameById}
          canteenMatches={(canteens.data ?? []).filter((canteen) =>
            (canteen.name ?? '').toLowerCase().includes(term.trim().toLowerCase()),
          )}
        />
      ) : (
        <FlatList
          data={canteens.data ?? []}
          keyExtractor={(canteen) => canteen.id ?? ''}
          contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ gap: t.space.lg, marginBottom: t.space.xs }}>
              {order ? (
                <Pressable onPress={() => router.push(`/order/${order.id}`)}>
                  <Card style={{ borderColor: t.color.primary, borderWidth: 1.5 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Heading level="heading">{order.code}</Heading>
                      <StatusPill status={order.status} />
                    </View>
                    <Body muted>
                      {order.canteen_name_snapshot} · {formatPaise(order.total_paise)}
                    </Body>
                  </Card>
                </Pressable>
              ) : null}

              {(favourites.data ?? []).length > 0 ? (
                <View style={{ gap: t.space.sm }}>
                  <SectionHeader title="Order again" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
                    {(favourites.data ?? []).map((row) =>
                      row.menu_items ? (
                        <Pressable
                          key={row.menu_item_id}
                          onPress={() => router.push(`/canteen/${row.menu_items!.canteen_id}`)}
                          accessibilityRole="button"
                          accessibilityLabel={`${row.menu_items.name}, go to its canteen`}
                        >
                          <Badge
                            label={`${row.menu_items.name} · ${formatPaise(row.menu_items.price_paise)}`}
                            tone="primary"
                          />
                        </Pressable>
                      ) : null,
                    )}
                  </View>
                </View>
              ) : null}

              <SectionHeader title="Canteens" />
            </View>
          }
          renderItem={({ item }) => <CanteenCard canteen={item} />}
          ListEmptyComponent={
            <EmptyState title="No canteens yet" body="An admin has not added any canteens." />
          }
          refreshing={canteens.isFetching}
          onRefresh={() => void canteens.refetch()}
        />
      )}
    </Screen>
  );
}

/** The search input. Its own component so the clear button and icon stay together. */
function SearchBar({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const t = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.sm,
        borderWidth: 1,
        borderColor: t.color.border,
        backgroundColor: t.color.surface,
        borderRadius: t.radius.md,
        paddingHorizontal: t.space.lg,
        minHeight: t.minTouchTarget,
      }}
    >
      <Text style={{ fontSize: 16, color: t.color.textMuted }}>⌕</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search Maggi, samosa, a canteen…"
        placeholderTextColor={t.color.textFaint}
        accessibilityLabel="Search dishes"
        returnKeyType="search"
        autoCorrect={false}
        style={{ flex: 1, color: t.color.text, fontSize: t.font.body.fontSize }}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={t.hitSlop}
        >
          <Text style={{ fontSize: 16, color: t.color.textMuted }}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Dish results across every canteen.
 *
 * Tapping one opens its canteen rather than adding straight from here: the cart is
 * single-canteen (the database refuses a mixed one), so adding from a flat result
 * list would fire the "start a new cart?" prompt far more often than it helps.
 */
function DishResults({
  term,
  canteenNameById,
  canteenMatches,
}: {
  term: string;
  canteenNameById: Map<string | null, string>;
  canteenMatches: Canteen[];
}) {
  const t = useTheme();
  const results = useMenuSearch(term);

  if (results.isLoading) {
    return (
      <View style={{ padding: t.space.lg }}>
        <SkeletonList rows={3} />
      </View>
    );
  }

  const items = results.data ?? [];

  if (items.length === 0 && canteenMatches.length === 0) {
    return (
      <EmptyState
        title={`Nothing called “${term.trim()}”`}
        body="Try a shorter word, or browse the canteens."
      />
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      /*
       * Canteen matches ride above the dishes rather than in a list of their own:
       * two stacked FlatLists would fight over the same vertical scroll. They are
       * filtered from the canteens already in the cache, so typing a canteen's name
       * costs no request at all.
       */
      ListHeaderComponent={
        canteenMatches.length > 0 ? (
          <View style={{ gap: t.space.md, marginBottom: t.space.xs }}>
            <SectionHeader title="Canteens" />
            {canteenMatches.map((canteen) => (
              <CanteenCard key={canteen.id ?? ''} canteen={canteen} />
            ))}
            {items.length > 0 ? <SectionHeader title="Dishes" /> : null}
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/canteen/${item.canteen_id}`)}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${canteenNameById.get(item.canteen_id) ?? 'canteen'}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <Card style={{ opacity: item.is_available ? 1 : 0.55 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              <Thumb name={item.name} uri={item.image_url} size={52} />
              <View style={{ flex: 1, gap: t.space.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                  <VegMark veg={item.is_veg} />
                  <Heading level="heading">{item.name}</Heading>
                </View>
                <Body muted>{canteenNameById.get(item.canteen_id) ?? 'Canteen'}</Body>
              </View>
              <View style={{ alignItems: 'flex-end', gap: t.space.xs }}>
                <Price value={formatPaise(item.price_paise)} />
                {!item.is_available ? <Badge label="Sold out" tone="neutral" /> : null}
              </View>
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}

function CanteenCard({ canteen }: { canteen: Canteen }) {
  const t = useTheme();
  // `is_open` is computed by the view from opening hours, so it is never stale.
  const open = Boolean(canteen.is_open) && Boolean(canteen.is_accepting_orders);
  const name = canteen.name ?? 'Canteen';

  return (
    <Pressable
      onPress={() => canteen.id && router.push(`/canteen/${canteen.id}`)}
      disabled={!canteen.id}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${open ? 'open' : 'closed'}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {/*
       * A closed canteen stays browsable (§7) but must never be mistaken for an open
       * one at a glance, so it loses the accent border and dims -- two signals, not
       * just the badge, because the badge is the smallest thing on the card.
       */}
      <Card
        style={{
          opacity: open ? 1 : 0.55,
          ...(open ? { borderColor: t.color.primary, borderWidth: 1.5 } : {}),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <Thumb name={name} uri={canteen.image_url} size={52} />
          <View style={{ flex: 1, gap: t.space.xs }}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.sm }}
            >
              <Heading level="heading">{name}</Heading>
              <Badge label={open ? 'Open' : 'Closed'} tone={open ? 'success' : 'neutral'} />
            </View>
            {canteen.description ? <Body muted>{canteen.description}</Body> : null}
            <Body muted>
              {canteen.opens_at?.slice(0, 5)}–{canteen.closes_at?.slice(0, 5)}
              {canteen.min_order_paise ? ` · min ${formatPaise(canteen.min_order_paise)}` : ''}
            </Body>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
