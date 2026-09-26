import { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isAwaitingOnboarding, type OrderWithItems } from '@canteza/api';
import {
  formatPaise,
  nextStatusesFor,
  STUDENT_STATUS_LABEL,
  toAppError,
  type OrderStatus,
} from '@canteza/shared';
import {
  orderFilters,
  useCanteenOrderCounts,
  useCanteenOrders,
  useOrdersRealtime,
  useTransitionOrder,
} from '../../src/lib/queries';
import { useIdentity, useSession } from '../../src/lib/session';
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
import { OrderLines, StatusPill } from '../../src/components/order';
import { AppBar, IconButton } from '../../src/components/patterns';
import { useTheme } from '../../src/theme';

/**
 * The counter's screen.
 *
 * Designed for someone with flour on their hands during a rush: one list, big
 * buttons, no navigation to reach the action. The buttons are generated from
 * `nextStatusesFor(status, 'canteen')`, so they cannot offer a move the database
 * would refuse, and adding a status to the state machine updates them for free.
 */

const TABS: Array<{ key: string; label: string; statuses: readonly OrderStatus[] }> = [
  { key: 'new', label: 'New', statuses: ['pending'] },
  { key: 'cooking', label: 'Cooking', statuses: ['accepted', 'preparing'] },
  { key: 'ready', label: 'Ready', statuses: ['ready', 'assigned', 'picked_up'] },
  { key: 'done', label: 'Done', statuses: ['delivered', 'cancelled', 'rejected'] },
];

/**
 * The statuses whose counts are worth fetching: every live one, in a single query.
 *
 * "Done" is deliberately not counted. It is every order this canteen has ever
 * finished, so the number grows without bound, costs more to fetch the longer the
 * canteen has been open, and tells the counter nothing they can act on. A badge is
 * there to say "look here now".
 */
const COUNTED_STATUSES = TABS.filter((tab) => tab.key !== 'done').flatMap((tab) => tab.statuses);

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  accepted: 'Accept',
  rejected: 'Reject',
  preparing: 'Start cooking',
  ready: 'Ready for pickup',
  delivered: 'I delivered it',
};

export default function CanteenOrders() {
  const t = useTheme();
  const router = useRouter();
  const identity = useIdentity();
  const { signOut } = useSession();
  const [tab, setTab] = useState(TABS[0]!);

  const canteenId = identity.canteenId ?? '';
  const orders = useCanteenOrders(canteenId, tab.statuses);
  // One request for every live tab's badge. Keyed under the `orders` root, so the
  // realtime subscription below refreshes the counts as well as the list.
  const counts = useCanteenOrderCounts(canteenId, COUNTED_STATUSES).data ?? {};
  useOrdersRealtime(canteenId ? orderFilters.forCanteen(canteenId) : null);

  if (isAwaitingOnboarding(identity)) {
    return (
      <Screen>
        <EmptyState
          title="Waiting for setup"
          body="This account is not linked to a canteen yet. An admin needs to finish onboarding it."
        />
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: t.space.lg, paddingBottom: 0, gap: t.space.md }}>
        <AppBar
          title="Orders"
          subtitle="Live — new orders arrive on their own"
          right={
            <View style={{ flexDirection: 'row', gap: t.space.sm }}>
              <IconButton glyph="☰" label="Menu" onPress={() => router.push('/menu')} />
              <IconButton glyph="⏻" label="Sign out" onPress={() => void signOut()} />
            </View>
          }
        />

        {/*
         * The service board's tab bar. Full-width segments with a 48pt target,
         * because this is tapped with a thumb over a hot counter (§14).
         *
         * The selected label reads `onPrimary`, not the default text colour: it sits
         * on the primary fill, and the old default put near-black on orange, which
         * is the one combination in this palette that fails contrast.
         */}
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          {TABS.map((item) => {
            const selected = item.key === tab.key;
            // Undefined for "Done", which is not counted, and 0 for a live tab with
            // nothing in it. Only a non-zero count earns a badge: a row of zeroes is
            // four things to read that all say "nothing here".
            const count = item.statuses.reduce<number | undefined>((sum, status) => {
              if (!COUNTED_STATUSES.includes(status)) return sum;
              return (sum ?? 0) + (counts[status] ?? 0);
            }, undefined);

            return (
              <Pressable
                key={item.key}
                onPress={() => setTab(item)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={
                  count ? `${item.label}, ${count} order${count === 1 ? '' : 's'}` : item.label
                }
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: t.minTouchTarget,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: t.space.xs,
                  borderRadius: t.radius.md,
                  backgroundColor: selected ? t.color.primary : t.color.surfaceAlt,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text
                  style={[
                    t.font.label,
                    { color: selected ? t.color.onPrimary : t.color.textMuted },
                  ]}
                >
                  {item.label}
                </Text>

                {count ? (
                  <View
                    // The count is already in the tab's accessibility label above, so
                    // the badge itself is hidden from a screen reader rather than
                    // being announced a second time as a bare number.
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      minWidth: 20,
                      paddingHorizontal: 5,
                      height: 20,
                      borderRadius: t.radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? t.color.onPrimary : t.color.primary,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        fontVariant: ['tabular-nums'],
                        color: selected ? t.color.primary : t.color.onPrimary,
                      }}
                    >
                      {count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {orders.isLoading ? (
        <Loading label="Loading orders…" />
      ) : orders.isError ? (
        <ErrorState
          message={toAppError(orders.error).userMessage}
          onRetry={() => void orders.refetch()}
        />
      ) : (
        <FlatList
          data={orders.data ?? []}
          keyExtractor={(order) => order.id}
          contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
          renderItem={({ item }) => <OrderCard order={item} />}
          ListEmptyComponent={
            <EmptyState
              title={`Nothing ${tab.label.toLowerCase()}`}
              body="New orders appear here the moment a student places one."
            />
          }
          refreshing={orders.isFetching}
          onRefresh={() => void orders.refetch()}
        />
      )}
    </Screen>
  );
}

function OrderCard({ order }: { order: OrderWithItems }) {
  const t = useTheme();
  const transition = useTransitionOrder();
  const status = order.status as OrderStatus;

  // The single source of truth for what this actor may do next.
  const actions = nextStatusesFor(status, 'canteen');

  function act(to: OrderStatus) {
    const run = (reason?: string) =>
      transition.mutate(
        { orderId: order.id, to, ...(reason ? { reason } : {}) },
        {
          onError: (err) => Alert.alert('Could not update', toAppError(err).userMessage),
        },
      );

    if (to === 'rejected') {
      Alert.alert('Reject this order?', `${order.code} will be cancelled and the student told.`, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => run('rejected by canteen') },
      ]);
      return;
    }
    if (to === 'delivered') {
      Alert.alert(
        'Delivered by you?',
        'Use this only when no delivery partner is on shift and you took it yourself.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes, delivered', onPress: () => run() },
        ],
      );
      return;
    }
    run();
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
        <Heading level="title">{order.code}</Heading>
        <StatusPill status={order.status} />
      </View>

      <OrderLines items={order.order_items ?? []} />

      <View style={{ height: 1, backgroundColor: t.color.border }} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
        <Body muted>
          {order.hostel_label} · {order.block}-{order.room}
        </Body>
        <Heading level="heading">{formatPaise(order.total_paise)}</Heading>
      </View>

      {order.delivery_note ? <Body muted>“{order.delivery_note}”</Body> : null}

      {order.delivery_partner_id ? (
        <Badge label="A delivery partner has this order" tone="info" />
      ) : null}

      {actions.length > 0 ? (
        <View style={{ gap: t.space.sm }}>
          {actions.map((to) => (
            <Button
              key={to}
              label={ACTION_LABEL[to] ?? STUDENT_STATUS_LABEL[to]}
              variant={to === 'rejected' ? 'danger' : 'primary'}
              onPress={() => act(to)}
              loading={transition.isPending}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}
