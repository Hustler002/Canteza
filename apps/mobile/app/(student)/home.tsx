import { useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import {
  estimatedMinutes,
  formatPaise,
  STUDENT_STATUS_LABEL,
  toAppError,
  type OrderStatus,
} from '@canteza/shared';
import type { Canteen, CanteenStats } from '@canteza/api';
import {
  useActiveOrder,
  useCanteens,
  useFavorites,
  useCanteenStats,
  useHostels,
  useMenuSearch,
  useNotificationsRealtime,
  useUnreadNotificationCount,
  useOrdersRealtime,
  orderFilters,
} from '../../src/lib/queries';
import { useConfirmSignOut, useIdentity } from '../../src/lib/session';
import { useCart } from '../../src/store/cart';
import { Badge, Button, Card, EmptyState, ErrorState, Screen } from '../../src/components/ui';
import {
  Fact,
  Icon,
  IconButton,
  Price,
  Rating,
  SectionHeader,
  SkeletonList,
  Thumb,
  VegMark,
} from '../../src/components/patterns';
import { Logo } from '../../src/components/logo';
import { FadeIn, webInteractive, type InteractionState } from '../../src/components/motion';
import { useTheme, type Theme } from '../../src/theme';

/** The browsing column: wider than a reading column, so canteens can sit two abreast. */
function wideColumn(t: Theme): ViewStyle {
  return { width: '100%', maxWidth: t.layout.wide, alignSelf: 'center' };
}

/**
 * A greeting that knows what time it is on campus. After eleven at night it stops being
 * polite and says what everyone is thinking.
 */
function greeting(firstName: string, hour: number): string {
  if (hour >= 23 || hour < 4) return `Late-night cravings, ${firstName}?`;
  if (hour < 12) return `Good morning, ${firstName}`;
  if (hour < 17) return `Good afternoon, ${firstName}`;
  return `Good evening, ${firstName}`;
}

export default function StudentHome() {
  const t = useTheme();
  const identity = useIdentity();
  const canteens = useCanteens();
  const activeOrder = useActiveOrder();
  const cartUnits = useCart((state) => state.totalUnits());
  const cartCanteen = useCart((state) => state.canteenId);
  const favourites = useFavorites();
  const stats = useCanteenStats();
  const hostels = useHostels();
  const [term, setTerm] = useState('');
  const unreadCount = useUnreadNotificationCount(identity.userId).data ?? 0;
  const confirmSignOut = useConfirmSignOut();
  const { width } = useWindowDimensions();
  // Two canteens abreast once there is room for two readable cards; one on a phone.
  const columns = width >= t.layout.gridBreakpoint ? 2 : 1;

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
  const firstName = identity.profile.full_name?.split(' ')[0] || 'there';

  // Live status without polling: an event invalidates, the query refetches.
  useOrdersRealtime(orderFilters.forStudent(identity.userId));
  // A notification landing bumps the bell without a refresh or a poll.
  useNotificationsRealtime(identity.userId);

  // A skeleton rather than a spinner: it says "a list of canteens is arriving",
  // which reads as fast, where a centred spinner reads as stalled.
  if (canteens.isLoading) {
    return (
      <Screen width="wide">
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
  const statsById = new Map((stats.data ?? []).map((row) => [row.canteen_id, row]));
  const canteenNameById = new Map(
    (canteens.data ?? []).map((canteen) => [canteen.id, canteen.name ?? 'Canteen']),
  );
  const openCount = (canteens.data ?? []).filter(
    (canteen) => canteen.is_open && canteen.is_accepting_orders,
  ).length;

  return (
    <Screen
      padded={false}
      width="wide"
      footer={
        cartUnits > 0 && cartCanteen ? (
          <Button
            icon="bag-handle"
            label={`${cartUnits} item${cartUnits > 1 ? 's' : ''} added`}
            trailing="View cart ›"
            size="lg"
            onPress={() => router.push('/cart')}
          />
        ) : undefined
      }
    >
      <View
        style={[
          wideColumn(t),
          { paddingHorizontal: t.space.lg, paddingTop: t.space.md, gap: t.space.lg },
        ]}
      >
        {/*
         * The brand bar: the horizontal lockup on the left, the student's own places on the
         * right -- the brand sheet's nav bar. Home is the one screen that introduces the
         * product after sign-in; the rest carry a back button instead.
         */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <View style={{ flex: 1 }}>
            <Logo size={34} />
          </View>
          <View style={{ flexDirection: 'row', gap: t.space.sm }}>
            <IconButton
              icon="notifications-outline"
              label="Notifications"
              badge={unreadCount}
              onPress={() => router.push('/inbox')}
            />
            <IconButton
              icon="receipt-outline"
              label="Your orders"
              onPress={() => router.push('/my-orders')}
            />
            <IconButton icon="log-out-outline" label="Sign out" onPress={confirmSignOut} />
          </View>
        </View>

        <View style={{ gap: t.space.xxs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
            <Icon name="location" size={15} color={t.color.primary} />
            <Text style={[t.font.overline, { color: t.color.primary }]}>DELIVERING TO</Text>
          </View>
          <Text style={[t.font.heading, { color: t.color.text }]} numberOfLines={1}>
            {deliveryLine}
          </Text>
        </View>

        <Text style={[t.font.display, { color: t.color.text, fontSize: 26, lineHeight: 32 }]}>
          {greeting(firstName, new Date().getHours())}
        </Text>

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
          // numColumns cannot change on a mounted list, so a resize past the
          // breakpoint remounts it with the new column count.
          key={`canteens-${columns}`}
          numColumns={columns}
          data={canteens.data ?? []}
          keyExtractor={(canteen) => canteen.id ?? ''}
          contentContainerStyle={[
            wideColumn(t),
            { padding: t.space.lg, paddingTop: 0, gap: t.space.md },
          ]}
          {...(columns > 1 ? { columnWrapperStyle: { gap: t.space.md } } : {})}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ gap: t.space.xl, marginBottom: t.space.xs }}>
              {order ? <ActiveOrderBanner order={order} /> : null}

              {(favourites.data ?? []).length > 0 ? (
                <View style={{ gap: t.space.md }}>
                  <SectionHeader title="Order again" subtitle="Your favourites, one tap away" />
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: t.space.md, paddingBottom: t.space.xs }}
                  >
                    {(favourites.data ?? []).map((row, index) =>
                      row.menu_items ? (
                        <FadeIn key={row.menu_item_id} index={index}>
                          <FavouriteCard
                            name={row.menu_items.name}
                            price={formatPaise(row.menu_items.price_paise)}
                            canteen={canteenNameById.get(row.menu_items.canteen_id) ?? 'Canteen'}
                            onPress={() => router.push(`/canteen/${row.menu_items!.canteen_id}`)}
                          />
                        </FadeIn>
                      ) : null,
                    )}
                  </ScrollView>
                </View>
              ) : null}

              <SectionHeader
                title="Campus canteens"
                subtitle={
                  openCount > 0
                    ? `${openCount} open now · delivered to your room`
                    : 'All closed right now · you can still browse'
                }
              />
            </View>
          }
          renderItem={({ item, index }) => (
            <FadeIn index={index} style={columns > 1 ? { flex: 1 } : undefined}>
              <CanteenCard canteen={item} stats={statsById.get(item.id)} />
            </FadeIn>
          )}
          ListEmptyComponent={
            <EmptyState
              emoji="🏫"
              title="No canteens yet"
              body="An admin has not added any canteens."
            />
          }
          refreshing={canteens.isFetching}
          onRefresh={() => void canteens.refetch()}
        />
      )}
    </Screen>
  );
}

/**
 * The order in flight, as the loudest thing on the page: a saffron banner with what is
 * happening now and a way into the tracker. Nothing else on Home matters as much while
 * food is on its way.
 */
function ActiveOrderBanner({
  order,
}: {
  order: {
    id: string;
    code: string;
    status: string;
    canteen_name_snapshot: string | null;
    total_paise: number;
  };
}) {
  const t = useTheme();
  const label = STUDENT_STATUS_LABEL[order.status as OrderStatus] ?? order.status;

  return (
    <FadeIn>
      <Pressable
        onPress={() => router.push(`/order/${order.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Order ${order.code}, ${label}. Track it`}
        style={(state) => {
          const { pressed, hovered } = state as InteractionState;
          return [
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.space.lg,
              padding: t.space.lg,
              borderRadius: t.radius.lg,
              backgroundColor: hovered ? t.color.primaryStrong : t.color.primary,
              overflow: 'hidden',
              transform: [{ scale: pressed ? 0.985 : 1 }],
            },
            t.elevation.lifted,
            webInteractive(t.motion.quick),
          ];
        }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: t.color.onPrimaryVeil,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="bicycle" size={24} color={t.color.onPrimary} />
        </View>
        <View style={{ flex: 1, gap: t.space.xxs }}>
          <Text style={[t.font.overline, { color: t.color.onPrimary, opacity: 0.85 }]}>
            ORDER {order.code}
          </Text>
          <Text style={[t.font.title, { color: t.color.onPrimary }]} numberOfLines={2}>
            {label}
          </Text>
          <Text
            style={[t.font.caption, { color: t.color.onPrimary, opacity: 0.9 }]}
            numberOfLines={1}
          >
            {order.canteen_name_snapshot} · {formatPaise(order.total_paise)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xxs }}>
          <Text style={[t.font.label, { color: t.color.onPrimary }]}>Track</Text>
          <Icon name="chevron-forward" size={16} color={t.color.onPrimary} />
        </View>
      </Pressable>
    </FadeIn>
  );
}

/** A favourite dish in the "Order again" row: its tile, its name, its price, its canteen. */
function FavouriteCard({
  name,
  price,
  canteen,
  onPress,
}: {
  name: string;
  price: string;
  canteen: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${name}, ${price}, from ${canteen}. Go to its canteen`}
      padding="md"
      style={{ width: 168, gap: t.space.sm }}
    >
      <Thumb name={name} size={48} fallback="initial" />
      <View style={{ gap: t.space.xxs }}>
        <Text style={[t.font.label, { color: t.color.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[t.font.caption, { color: t.color.textMuted }]} numberOfLines={1}>
          {canteen}
        </Text>
      </View>
      <Price value={price} />
    </Card>
  );
}

/** The search input. Its own component so the clear button and icon stay together. */
function SearchBar({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.sm,
          borderWidth: 1.5,
          borderColor: focused ? t.color.primary : t.color.cardBorder,
          backgroundColor: t.color.surface,
          borderRadius: t.radius.md,
          paddingHorizontal: t.space.lg,
          minHeight: t.minTouchTarget + 4,
        },
        t.elevation.card,
      ]}
    >
      <Icon name="search" size={19} color={focused ? t.color.primary : t.color.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search Maggi, samosa, a canteen…"
        placeholderTextColor={t.color.textFaint}
        accessibilityLabel="Search dishes"
        returnKeyType="search"
        autoCorrect={false}
        style={[
          {
            flex: 1,
            alignSelf: 'stretch',
            color: t.color.text,
            fontSize: t.font.body.fontSize,
            ...(t.font.body.fontFamily ? { fontFamily: t.font.body.fontFamily } : {}),
          },
          // The ring above is the focus indicator; the browser's would double it.
          { outlineStyle: 'none' } as object,
        ]}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={t.hitSlop}
        >
          <Icon name="close-circle" size={20} color={t.color.textFaint} />
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
      <View style={[wideColumn(t), { padding: t.space.lg }]}>
        <SkeletonList rows={3} />
      </View>
    );
  }

  const items = results.data ?? [];

  if (items.length === 0 && canteenMatches.length === 0) {
    return (
      <EmptyState
        emoji="🔍"
        title={`Nothing called “${term.trim()}”`}
        body="Try a shorter word, or browse the canteens."
      />
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[
        wideColumn(t),
        { padding: t.space.lg, paddingTop: 0, gap: t.space.md },
      ]}
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
        ) : (
          <View style={{ marginBottom: t.space.xs }}>
            <SectionHeader
              title="Dishes"
              subtitle={`${items.length} match${items.length === 1 ? '' : 'es'} across campus`}
            />
          </View>
        )
      }
      renderItem={({ item, index }) => (
        <FadeIn index={index}>
          <Card
            onPress={() => router.push(`/canteen/${item.canteen_id}`)}
            accessibilityLabel={`${item.name}, ${canteenNameById.get(item.canteen_id) ?? 'canteen'}`}
            padding="md"
            style={{ opacity: item.is_available ? 1 : 0.55 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              <Thumb name={item.name} uri={item.image_url} size={52} fallback="initial" />
              <View style={{ flex: 1, gap: t.space.xxs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                  <VegMark veg={item.is_veg} />
                  <Text
                    style={[t.font.heading, { color: t.color.text, flexShrink: 1 }]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                </View>
                <Fact
                  icon="storefront-outline"
                  label={canteenNameById.get(item.canteen_id) ?? 'Canteen'}
                />
              </View>
              <View style={{ alignItems: 'flex-end', gap: t.space.xs }}>
                <Price value={formatPaise(item.price_paise)} />
                {!item.is_available ? <Badge label="Sold out" tone="neutral" /> : null}
              </View>
            </View>
          </Card>
        </FadeIn>
      )}
    />
  );
}

function CanteenCard({ canteen, stats }: { canteen: Canteen; stats?: CanteenStats | undefined }) {
  const t = useTheme();
  // `is_open` is computed by the view from opening hours, so it is never stale.
  const open = Boolean(canteen.is_open) && Boolean(canteen.is_accepting_orders);
  const name = canteen.name ?? 'Canteen';
  // Quoting a delivery time for a shut kitchen would be a promise nobody can keep.
  const eta = open ? estimatedMinutes(stats?.median_prep_minutes, stats?.prep_sample_size) : null;
  const hours = `${canteen.opens_at?.slice(0, 5) ?? ''}–${canteen.closes_at?.slice(0, 5) ?? ''}`;

  return (
    /*
     * A closed canteen stays browsable (§7) but must never be mistaken for an open
     * one at a glance, so it dims and its status says when it opens -- two signals,
     * not just the badge, because the badge is the smallest thing on the card.
     */
    <Card
      onPress={canteen.id ? () => router.push(`/canteen/${canteen.id}`) : undefined}
      accessibilityLabel={`${name}, ${open ? 'open' : 'closed'}`}
      padding="md"
      style={{ opacity: open ? 1 : 0.6, flex: 1 }}
    >
      <View style={{ flexDirection: 'row', gap: t.space.lg }}>
        <Thumb name={name} uri={canteen.image_url} size={92} fallback="initial" />
        <View style={{ flex: 1, gap: t.space.xs, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <Text
              style={[t.font.heading, { color: t.color.text, flex: 1, fontSize: 17 }]}
              numberOfLines={1}
            >
              {name}
            </Text>
            <Icon name="chevron-forward" size={16} color={t.color.textFaint} />
          </View>
          {canteen.description ? (
            <Text style={[t.font.caption, { color: t.color.textMuted }]} numberOfLines={2}>
              {canteen.description}
            </Text>
          ) : null}

          {/*
           * Rating and ETA, the two questions asked before tapping (§7). They sit
           * on their own row above the hours, because "is it good and how long"
           * decides the tap while the opening hours only explain a closed badge.
           */}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: t.space.md,
              marginTop: t.space.xxs,
            }}
          >
            <Rating average={stats?.avg_food_rating} count={stats?.review_count} />
            {eta !== null ? <Fact icon="time-outline" label={`${eta} min`} strong /> : null}
            {canteen.min_order_paise ? (
              <Fact icon="wallet-outline" label={`${formatPaise(canteen.min_order_paise)} min`} />
            ) : null}
          </View>

          <Badge
            dot
            label={
              open ? `Open · ${hours}` : `Closed · opens ${canteen.opens_at?.slice(0, 5) ?? ''}`
            }
            tone={open ? 'success' : 'neutral'}
          />
        </View>
      </View>
    </Card>
  );
}
