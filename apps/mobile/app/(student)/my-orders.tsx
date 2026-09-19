import { FlatList, Pressable, View } from 'react-native';
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
  Body,
  Card,
  EmptyState,
  ErrorState,
  Heading,
  Loading,
  Screen,
} from '../../src/components/ui';
import { StatusPill } from '../../src/components/order';
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
      <FlatList
        data={orders.data ?? []}
        keyExtractor={(order) => order.id}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
        ListHeaderComponent={
          <View style={{ gap: t.space.xs, marginBottom: t.space.sm }}>
            <Heading level="display">Your orders</Heading>
            <Body muted>Tap one to see what was in it and what it cost.</Body>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Nothing yet"
            body="Your orders will show up here once you have placed one."
          />
        }
        renderItem={({ item }) => <OrderRow order={item} />}
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

  return (
    <Pressable
      onPress={() => router.push(`/order/${order.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.code}, ${formatPaise(order.total_paise)}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={live ? { borderColor: t.color.primary } : {}}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
          <Heading level="heading">{order.canteen_name_snapshot}</Heading>
          <StatusPill status={order.status} />
        </View>

        <Body muted>
          {order.code} · {formatCampusDateTime(order.created_at)}
        </Body>

        {/*
         * From the order's own snapshot, never the live menu: a dish renamed or
         * repriced since must not rewrite what this receipt says (rule 6).
         */}
        <Body>
          {order.order_items.map((item) => `${item.quantity} × ${item.name_snapshot}`).join(', ')}
        </Body>

        <Body muted>
          {units} {units === 1 ? 'item' : 'items'} · {formatPaise(order.total_paise)}
        </Body>
      </Card>
    </Pressable>
  );
}
