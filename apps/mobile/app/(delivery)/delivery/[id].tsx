import { Alert, View } from 'react-native';
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
        <Button label="← Back" variant="secondary" onPress={() => router.replace('/deliveries')} />
        <EmptyState
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
      Alert.alert('Give this delivery back?', 'It returns to your canteen for someone else.', [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Give it back',
          style: 'destructive',
          onPress: () =>
            release.mutate(orderId, {
              onSuccess: () => router.replace('/deliveries'),
              onError: (err) => Alert.alert('Could not release', toAppError(err).userMessage),
            }),
        },
      ]);
      return;
    }

    if (to === 'delivered') {
      Alert.alert(
        'Handed over?',
        `Confirm you gave the food to the student and collected ${formatPaise(data.total_paise)} in cash.`,
        [
          { text: 'Not yet', style: 'cancel' },
          {
            text: 'Delivered',
            onPress: () =>
              transition.mutate(
                { orderId, to },
                {
                  onSuccess: () => router.replace('/deliveries'),
                  onError: (err) => Alert.alert('Could not update', toAppError(err).userMessage),
                },
              ),
          },
        ],
      );
      return;
    }

    transition.mutate(
      { orderId, to },
      { onError: (err) => Alert.alert('Could not update', toAppError(err).userMessage) },
    );
  }

  return (
    <Screen scroll>
      <Button
        label="← All deliveries"
        variant="secondary"
        onPress={() => router.replace('/deliveries')}
      />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
        <Heading level="display">{data.code}</Heading>
        <StatusPill status={data.status} />
      </View>

      <Card>
        <Body muted>Pick up from</Body>
        <Heading level="title">{data.canteen_name_snapshot}</Heading>
      </Card>

      <Card style={{ borderColor: t.color.primary }}>
        <Body muted>Deliver to</Body>
        <Heading level="display">{data.hostel_label}</Heading>
        <Heading level="title">
          Block {data.block} · Room {data.room}
        </Heading>
        {data.delivery_note ? (
          <>
            <Body muted>Note from the student</Body>
            <Body>“{data.delivery_note}”</Body>
          </>
        ) : null}
      </Card>

      <Card>
        <Heading level="heading">What you are carrying</Heading>
        <OrderLines items={data.order_items ?? []} />
      </Card>

      <Card>
        <Heading level="heading">Money</Heading>
        <Badge label={`Collect ${formatPaise(data.total_paise)} in cash`} tone="primary" />
        <Body muted>
          Hand this to your canteen. {BRAND.name} does not take a cut of the food, and your canteen
          pays you directly.
        </Body>
      </Card>

      {isTerminal(status) ? (
        <Body muted>This delivery is finished.</Body>
      ) : (
        <View style={{ gap: t.space.sm }}>
          {moves.map((to) => (
            <Button
              key={to}
              label={ACTION_LABEL[to] ?? to}
              variant={to === 'ready' ? 'secondary' : 'primary'}
              onPress={() => act(to)}
              loading={transition.isPending || release.isPending}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
