import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  canStudentCancel,
  formatPaise,
  isTerminal,
  toAppError,
  type OrderStatus,
} from '@campuseats/shared';
import {
  orderFilters,
  useOrder,
  useOrdersRealtime,
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
import { MoneyRow, OrderLines, ProgressTrail, StatusPill } from '../../../src/components/order';
import { useTheme } from '../../../src/theme';

/**
 * Live order tracking.
 *
 * Realtime invalidates the query; the query re-renders. Nothing here patches state
 * from an event payload, so a dropped socket degrades to normal refetching rather
 * than to a screen frozen on a stale status.
 */
export default function OrderTracker() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = id ?? '';
  const order = useOrder(orderId);
  const transition = useTransitionOrder();

  useOrdersRealtime(orderId ? orderFilters.byId(orderId) : null);

  if (order.isLoading) return <Loading label="Loading your order…" />;
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
        <Button label="← Back" variant="secondary" onPress={() => router.replace('/')} />
        <EmptyState title="Order not found" body="It may belong to another account." />
      </Screen>
    );
  }

  const data = order.data;
  const status = data.status as OrderStatus;
  const cancellable = canStudentCancel(status);

  function cancel() {
    Alert.alert('Cancel this order?', 'The canteen has not started cooking yet.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: () =>
          transition.mutate(
            { orderId, to: 'cancelled', reason: 'cancelled by student' },
            {
              onError: (err) =>
                // The canteen may have accepted in the same second; that is a real
                // outcome, not a glitch, so it is said plainly.
                Alert.alert('Could not cancel', toAppError(err).userMessage),
            },
          ),
      },
    ]);
  }

  return (
    <Screen scroll>
      <Button label="← Home" variant="secondary" onPress={() => router.replace('/')} />

      <View style={{ gap: t.space.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
          <Heading level="display">{data.code}</Heading>
          <StatusPill status={data.status} />
        </View>
        <Body muted>{data.canteen_name_snapshot}</Body>
      </View>

      {!isTerminal(status) ? (
        <Card>
          <ProgressTrail status={data.status} />
        </Card>
      ) : null}

      <Card>
        <Heading level="heading">Delivering to</Heading>
        <Body>
          {data.hostel_label}, Block {data.block}, Room {data.room}
        </Body>
        {data.delivery_note ? <Body muted>“{data.delivery_note}”</Body> : null}
      </Card>

      <Card>
        <Heading level="heading">Items</Heading>
        <OrderLines items={data.order_items ?? []} />
        <View style={{ height: 1, backgroundColor: t.color.border }} />
        <MoneyRow label="Subtotal" amountPaise={data.subtotal_paise} />
        {data.discount_paise > 0 ? (
          <MoneyRow label="Discount" amountPaise={-data.discount_paise} />
        ) : null}
        <MoneyRow label="Delivery" amountPaise={data.delivery_fee_paise} />
        <MoneyRow label="Total" amountPaise={data.total_paise} strong />
        <Badge label={`Pay ${formatPaise(data.total_paise)} in cash on delivery`} tone="info" />
      </Card>

      {data.cancellation_reason ? (
        <Card>
          <Heading level="heading">Why it was cancelled</Heading>
          <Body muted>{data.cancellation_reason}</Body>
        </Card>
      ) : null}

      {cancellable ? (
        <Button
          label="Cancel order"
          variant="danger"
          onPress={cancel}
          loading={transition.isPending}
        />
      ) : !isTerminal(status) ? (
        <Body muted>
          The canteen has started on this order, so it can no longer be cancelled from here. Contact
          them if something is wrong.
        </Body>
      ) : null}
    </Screen>
  );
}
