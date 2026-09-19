import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { formatPaise, toAppError } from '@canteza/shared';
import type { Canteen } from '@canteza/api';
import {
  useActiveOrder,
  useCanteens,
  useFavorites,
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
  Loading,
  Screen,
} from '../../src/components/ui';
import { StatusPill } from '../../src/components/order';
import { useTheme } from '../../src/theme';

export default function StudentHome() {
  const t = useTheme();
  const identity = useIdentity();
  const canteens = useCanteens();
  const activeOrder = useActiveOrder();
  const cartUnits = useCart((state) => state.totalUnits());
  const cartCanteen = useCart((state) => state.canteenId);
  const favourites = useFavorites();

  // Live status without polling: an event invalidates, the query refetches.
  useOrdersRealtime(orderFilters.forStudent(identity.userId));

  if (canteens.isLoading) return <Loading label="Finding canteens…" />;
  if (canteens.isError) {
    return (
      <ErrorState
        message={toAppError(canteens.error).userMessage}
        onRetry={() => void canteens.refetch()}
      />
    );
  }

  const order = activeOrder.data;

  return (
    <Screen padded={false}>
      <FlatList
        data={canteens.data ?? []}
        keyExtractor={(canteen) => canteen.id ?? ''}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
        ListHeaderComponent={
          <View style={{ gap: t.space.lg, marginBottom: t.space.sm }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: t.space.md,
              }}
            >
              <View style={{ flex: 1, gap: t.space.xs }}>
                <Heading level="display">
                  Hi {identity.profile.full_name?.split(' ')[0] || 'there'}
                </Heading>
                <Body muted>What are you eating tonight?</Body>
              </View>
              <Button
                label="Your orders"
                variant="secondary"
                onPress={() => router.push('/my-orders')}
              />
            </View>

            {order ? (
              <Pressable onPress={() => router.push(`/order/${order.id}`)}>
                <Card>
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
              <Card>
                <Heading level="heading">Your favourites</Heading>
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
              </Card>
            ) : null}

            {cartUnits > 0 && cartCanteen ? (
              <Pressable onPress={() => router.push('/cart')}>
                <Card style={{ borderColor: t.color.primary }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Heading level="heading">Your cart</Heading>
                    <Badge label={`${cartUnits} item${cartUnits > 1 ? 's' : ''}`} tone="primary" />
                  </View>
                  <Body muted>Tap to review and check out.</Body>
                </Card>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <CanteenCard canteen={item} />}
        ListEmptyComponent={
          <EmptyState title="No canteens yet" body="An admin has not added any canteens." />
        }
        refreshing={canteens.isFetching}
        onRefresh={() => void canteens.refetch()}
      />
    </Screen>
  );
}

function CanteenCard({ canteen }: { canteen: Canteen }) {
  const t = useTheme();
  // `is_open` is computed by the view from opening hours, so it is never stale.
  const open = Boolean(canteen.is_open) && Boolean(canteen.is_accepting_orders);

  return (
    <Pressable
      onPress={() => canteen.id && router.push(`/canteen/${canteen.id}`)}
      disabled={!canteen.id}
      accessibilityRole="button"
      accessibilityLabel={`${canteen.name}, ${open ? 'open' : 'closed'}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={{ opacity: open ? 1 : 0.6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
          <Heading level="heading">{canteen.name}</Heading>
          <Badge label={open ? 'Open' : 'Closed'} tone={open ? 'success' : 'neutral'} />
        </View>
        <Body muted>{canteen.description}</Body>
        <Body muted>
          {canteen.opens_at?.slice(0, 5)}–{canteen.closes_at?.slice(0, 5)}
          {canteen.min_order_paise ? ` · min ${formatPaise(canteen.min_order_paise)}` : ''}
        </Body>
      </Card>
    </Pressable>
  );
}
