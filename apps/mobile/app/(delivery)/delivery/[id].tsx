import { Text, View } from 'react-native';
import { confirm, notify } from '../../../src/lib/dialog';
import { router, useLocalSearchParams } from 'expo-router';
import {
  BRAND,
  formatPaise,
  isTerminal,
  nextStatusesFor,
  toAppError,
  type OrderStatus,
} from '@canteza/shared';
import {
  orderFilters,
  useOrder,
  useOrdersRealtime,
  useReleaseDelivery,
  useTransitionOrder,
} from '../../../src/lib/queries';
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
import { OrderLines, StatusPill } from '../../../src/components/order';
import { AppBar, CardTitle, Icon } from '../../../src/components/patterns';
import { useTheme } from '../../../src/theme';

/**
 * One delivery, in hand.
 *
 * The destination is the whole point of the screen, so hostel/block/room is the
 * largest thing on it. Buttons come from `nextStatusesFor(status, 'delivery')`, so
 * this cannot offer a move the database would refuse.
 */

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  picked_up: 'Picked it up',
  delivered: 'Delivered',
  ready: 'Give it back',
};

export default function DeliveryDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = id ?? '';
  const order = useOrder(orderId);
  const transition = useTransitionOrder();
  const release = useReleaseDelivery();

  useOrdersRealtime(orderId ? orderFilters.byId(orderId) : null);

  if (order.isLoading) return <Loading label="Loading delivery…" />;
  if (order.isError) {
    return (
      <ErrorState
        message={toAppError(order.error).userMessage}
        onRetry={() => void order.refetch()}
      />
    );
  }
  if (!order.data) {
    return (
      <Screen>
        <AppBar title="Delivery" onBack={() => router.replace('/deliveries')} />
        <EmptyState
          emoji="🤷"
          title="Not your delivery"
          body="Another partner may have taken it, or it was cancelled."
        />
      </Screen>
    );
  }

  const data = order.data;
  const status = data.status as OrderStatus;
  // `ready` here means handing the order back, which has its own confirmation.
  const moves = nextStatusesFor(status, 'delivery').filter((next) => next !== 'assigned');

  function act(to: OrderStatus) {
    if (to === 'ready') {
      confirm({
        title: 'Give this delivery back?',
        message: 'It returns to your canteen for someone else.',
        cancelLabel: 'Keep it',
        confirmLabel: 'Give it back',
        destructive: true,
        onConfirm: () =>
          release.mutate(orderId, {
            onSuccess: () => router.replace('/deliveries'),
            onError: (err) => notify('Could not release', toAppError(err).userMessage),
          }),
      });
      return;
    }

    if (to === 'delivered') {
      confirm({
        title: 'Handed over?',
        message: `Confirm you gave the food to the student and collected ${formatPaise(data.total_paise)} in cash.`,
        cancelLabel: 'Not yet',
        confirmLabel: 'Delivered',
        onConfirm: () =>
          transition.mutate(
            { orderId, to },
            {
              onSuccess: () => router.replace('/deliveries'),
              onError: (err) => notify('Could not update', toAppError(err).userMessage),
            },
          ),
      });
      return;
    }

    transition.mutate(
      { orderId, to },
      { onError: (err) => notify('Could not update', toAppError(err).userMessage) },
    );
  }

  return (
    <Screen
      scroll
      /*
       * The actions live in the sticky bar rather than at the end of the scroll.
       * A partner is holding a bag in one hand at a hostel door (§15) -- the button
       * they need has to be under the thumb without scrolling to find it.
       */
      footer={
        isTerminal(status) ? undefined : (
          <View style={{ gap: t.space.sm }}>
            {moves.map((to) => (
              <Button
                key={to}
                icon={
                  to === 'ready'
                    ? 'return-up-back-outline'
                    : to === 'delivered'
                      ? 'checkmark-done'
                      : 'bag-check-outline'
                }
                label={ACTION_LABEL[to] ?? to}
                variant={to === 'ready' ? 'secondary' : 'primary'}
                size={to === 'ready' ? 'md' : 'lg'}
                onPress={() => act(to)}
                loading={transition.isPending || release.isPending}
              />
            ))}
          </View>
        )
      }
    >
      <AppBar
        title={data.code}
        subtitle={`Pick up from ${data.canteen_name_snapshot}`}
        onBack={() => router.replace('/deliveries')}
        right={<StatusPill status={data.status} />}
      />

      <Card highlight style={{ padding: t.space.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
          <Icon name="location" size={16} color={t.color.primary} />
          <Text style={[t.font.overline, { color: t.color.primary }]}>DELIVER TO</Text>
        </View>
        <Heading level="display">{data.hostel_label}</Heading>
        <Heading level="title">
          Block {data.block} · Room {data.room}
        </Heading>
        {data.delivery_note ? (
          <View
            style={{
              gap: t.space.xxs,
              padding: t.space.md,
              borderRadius: t.radius.md,
              backgroundColor: t.color.surfaceAlt,
            }}
          >
            <Text style={[t.font.overline, { color: t.color.textMuted }]}>
              NOTE FROM THE STUDENT
            </Text>
            <Body>“{data.delivery_note}”</Body>
          </View>
        ) : null}
      </Card>

      <Card>
        <CardTitle icon="bag-handle-outline" title="What you are carrying" />
        <OrderLines items={data.order_items ?? []} />
      </Card>

      <Card>
        <CardTitle icon="cash-outline" title="Money" />
        <Badge label={`Collect ${formatPaise(data.total_paise)} in cash`} tone="primary" />
        <Body muted>
          Hand this to your canteen. {BRAND.name} does not take a cut of the food, and your canteen
          pays you directly.
        </Body>
      </Card>

      {isTerminal(status) ? <Body muted>This delivery is finished.</Body> : null}
    </Screen>
  );
}
