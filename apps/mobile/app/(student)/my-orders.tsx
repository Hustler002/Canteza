import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { OrderWithItems } from '@canteza/api';
import {
  formatCampusDateTime,
  formatPaise,
  isTerminal,
  toAppError,
  type OrderStatus,
} from '@canteza/shared';
import { orderFilters, useMyOrders, useOrdersRealtime } from '../../src/lib/queries';
import { useIdentity } from '../../src/lib/session';
import {
  Card,
  columnStyle,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
} from '../../src/components/ui';
import { StatusPill } from '../../src/components/order';
import { AppBar, Divider, Icon, Price, Thumb } from '../../src/components/patterns';
import { FadeIn } from '../../src/components/motion';
import { ReorderButton } from '../../src/components/reorder';
import { useTheme } from '../../src/theme';

/**
 * Everything this student has ordered.
 *
 * The file is `my-orders.tsx`, not `orders.tsx`, because route groups do not appear in
 * the URL (rule 19) and `(canteen)/orders.tsx` already owns `/orders`. Two files named
 * the same in different groups would both resolve to one route and whichever loaded
 * first would win — a student would land on the counter's board.
 *
 * Realtime is subscribed here as well as on the home screen: an order that moves while
 * this list is open should not need a pull to refresh, and the subscription invalidates
 * the same key either way (ADR 004).
 */
export default function MyOrders() {
  const t = useTheme();
  const identity = useIdentity();
  const orders = useMyOrders();

  useOrdersRealtime(orderFilters.forStudent(identity.userId));

  if (orders.isLoading) return <Loading label="Loading your orders…" />;
  if (orders.isError) {
    return (
      <ErrorState
        message={toAppError(orders.error).userMessage}
        onRetry={() => void orders.refetch()}
      />
    );
  }

  return (
    <Screen padded={false}>
      <View style={[columnStyle(t), { paddingHorizontal: t.space.lg, paddingTop: t.space.sm }]}>
        <AppBar
          title="Your orders"
          subtitle="Tap one to see it, or repeat it in a tap"
          onBack={() => router.back()}
        />
      </View>
      <FlatList
        data={orders.data ?? []}
        keyExtractor={(order) => order.id}
        contentContainerStyle={[
          columnStyle(t),
          { padding: t.space.lg, paddingTop: 0, gap: t.space.md },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            emoji="🧾"
            title="No orders yet"
            body="Once you order something, it shows up here ready to repeat."
            action={{ label: 'Browse canteens', onPress: () => router.replace('/') }}
          />
        }
        renderItem={({ item, index }) => (
          <FadeIn index={index}>
            <OrderRow order={item} />
          </FadeIn>
        )}
        refreshing={orders.isFetching}
        onRefresh={() => void orders.refetch()}
      />
    </Screen>
  );
}

function OrderRow({ order }: { order: OrderWithItems }) {
  const t = useTheme();
  const units = order.order_items.reduce((sum, item) => sum + item.quantity, 0);
  // A live order is still worth opening for the tracker; a finished one is a receipt.
  // `orders.status` is a plain string in the generated types, the same cast `StatusPill`
  // makes: the database's check constraint is what keeps it inside the union.
  const live = !isTerminal(order.status as OrderStatus);
  const summary = order.order_items
    .map((item) => `${item.quantity} × ${item.name_snapshot}`)
    .join(', ');

  return (
    <Card highlight={live}>
      {/*
       * The card opens the order; the reorder button below is its own target. The
       * Pressable wraps only the readable part so the two taps never fight (§12).
       */}
      <Pressable
        onPress={() => router.push(`/order/${order.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Order ${order.code}, ${formatPaise(order.total_paise)}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, gap: t.space.md })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <Thumb name={order.canteen_name_snapshot ?? 'Canteen'} size={44} fallback="initial" />
          <View style={{ flex: 1, gap: t.space.xxs }}>
            <Text style={[t.font.heading, { color: t.color.text }]} numberOfLines={1}>
              {order.canteen_name_snapshot}
            </Text>
            <Text style={[t.font.caption, { color: t.color.textMuted }]}>
              {order.code} · {formatCampusDateTime(order.created_at)}
            </Text>
          </View>
          <Icon name="chevron-forward" size={16} color={t.color.textFaint} />
        </View>

        <Divider dashed />

        {/*
         * From the order's own snapshot, never the live menu: a dish renamed or
         * repriced since must not rewrite what this receipt says (rule 6).
         */}
        <Text style={[t.font.body, { color: t.color.text }]} numberOfLines={2}>
          {summary}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <StatusPill status={order.status} />
          <View style={{ flex: 1 }} />
          <Text style={[t.font.caption, { color: t.color.textMuted }]}>
            {units} {units === 1 ? 'item' : 'items'} ·
          </Text>
          <Price value={formatPaise(order.total_paise)} />
        </View>
      </Pressable>

      {/* Repeating a finished order is the whole point of this screen. */}
      {!live ? <ReorderButton order={order} compact /> : null}
    </Card>
  );
}
