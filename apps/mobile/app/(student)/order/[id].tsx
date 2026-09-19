import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { OrderWithItems } from '@canteza/api';
import {
  canStudentCancel,
  formatPaise,
  isTerminal,
  toAppError,
  type OrderStatus,
} from '@canteza/shared';
import {
  orderFilters,
  useCreateReview,
  useMenu,
  useOrder,
  useOrderReview,
  useOrdersRealtime,
  useTransitionOrder,
} from '../../../src/lib/queries';
import { useIdentity } from '../../../src/lib/session';
import { useCart } from '../../../src/store/cart';
import {
  Badge,
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormError,
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

      {status === 'delivered' ? <RateCard order={data} /> : null}

      {isTerminal(status) ? <ReorderButton order={data} /> : null}

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

      <Button
        label="Report a problem"
        variant="secondary"
        onPress={() => router.push(`/support?order=${orderId}`)}
      />
    </Screen>
  );
}

/**
 * Rating a delivered order.
 *
 * Shown once and then replaced by what was said: `reviews.order_id` is unique, and
 * `reviews_insert_own` checks in SQL that the order is the writer's own, delivered, and
 * from the canteen being rated. The card disappearing after submit is the UI agreeing
 * with a rule it does not own.
 *
 * Food is required, delivery is optional, which is the schema's shape too
 * (`delivery_rating` is nullable): a canteen that carried its own order has no partner
 * to rate, and a forced answer there would be noise in the average.
 */
function RateCard({ order }: { order: OrderWithItems }) {
  const t = useTheme();
  const identity = useIdentity();
  const review = useOrderReview(order.id);
  const create = useCreateReview(order.id);
  const [food, setFood] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (review.isLoading) return null;

  if (review.data) {
    return (
      <Card>
        <Heading level="heading">You rated this</Heading>
        <Body>{'★'.repeat(review.data.food_rating)} food</Body>
        {review.data.delivery_rating ? (
          <Body>{'★'.repeat(review.data.delivery_rating)} delivery</Body>
        ) : null}
        {review.data.comment ? <Body muted>“{review.data.comment}”</Body> : null}
      </Card>
    );
  }

  function submit() {
    setError(null);
    if (food === 0) {
      setError('Pick a rating for the food first.');
      return;
    }
    create.mutate(
      {
        order_id: order.id,
        student_id: identity.userId,
        canteen_id: order.canteen_id,
        food_rating: food,
        // Null, not zero: "not rated" and "rated one star" are different answers.
        delivery_rating: delivery === 0 ? null : delivery,
        comment: comment.trim(),
      },
      { onError: (cause) => setError(toAppError(cause).userMessage) },
    );
  }

  return (
    <Card>
      <Heading level="heading">How was it?</Heading>
      <View style={{ gap: t.space.sm }}>
        <Body muted>Food</Body>
        <Stars value={food} onChange={setFood} label="Food rating" />
      </View>
      <View style={{ gap: t.space.sm }}>
        <Body muted>Delivery (optional)</Body>
        <Stars value={delivery} onChange={setDelivery} label="Delivery rating" />
      </View>
      <Field
        label="Anything to add? (optional)"
        value={comment}
        onChangeText={setComment}
        placeholder="Hot, on time, good portion"
      />
      <FormError message={error} />
      <Button label="Submit rating" loading={create.isPending} onPress={submit} />
    </Card>
  );
}

/** Tapping the star you are already on clears it, so a misfire is not permanent. */
function Stars({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.space.sm }} accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          onPress={() => onChange(star === value ? 0 : star)}
          accessibilityRole="radio"
          accessibilityState={{ selected: star <= value }}
          accessibilityLabel={`${star} star${star > 1 ? 's' : ''}`}
          hitSlop={t.hitSlop}
          style={({ pressed }) => ({
            minHeight: t.minTouchTarget,
            minWidth: t.minTouchTarget,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: t.radius.md,
            backgroundColor: star <= value ? t.color.primarySoft : t.color.surfaceAlt,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Heading level="heading">{star <= value ? '★' : '☆'}</Heading>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Order the same thing again.
 *
 * The cart holds ids and quantities and nothing else (rule 17), so this copies exactly
 * that -- and the price becomes whatever the menu says today, not what this receipt
 * says. That is the right behaviour and it is said out loud rather than discovered at
 * checkout.
 *
 * Dishes the canteen has retired since are dropped: `place_order` re-reads every price
 * from `menu_items`, so a line pointing at a dish that is off the menu cannot be priced
 * at all. Sold-out ones are dropped for a softer reason -- carrying one into a cart that
 * will refuse to check out is worse than saying so here.
 */
function ReorderButton({ order }: { order: OrderWithItems }) {
  const menu = useMenu(order.canteen_id);
  const { clear, add } = useCart();

  if (menu.isLoading) return null;

  const orderable = new Set(
    (menu.data ?? []).filter((item) => item.is_available).map((item) => item.id),
  );
  const lines = (order.order_items ?? []).filter(
    (item) => item.menu_item_id && orderable.has(item.menu_item_id),
  );
  const dropped = (order.order_items ?? []).length - lines.length;

  if (lines.length === 0) {
    return <Body muted>Nothing from this order is on the menu right now.</Body>;
  }

  function reorder() {
    // Clear first: the cart belongs to one canteen, and `add` refuses to mix rather
    // than silently dropping what was there.
    clear();
    for (const line of lines) {
      if (line.menu_item_id) add(order.canteen_id, line.menu_item_id, line.quantity);
    }
    router.push('/cart');
  }

  return (
    <View style={{ gap: 8 }}>
      <Button label="Order this again" variant="secondary" onPress={reorder} />
      <Body muted>
        {dropped > 0
          ? `${dropped} ${dropped === 1 ? 'dish is' : 'dishes are'} unavailable and will be left out. `
          : ''}
        Today's prices apply, not the ones on this receipt.
      </Body>
    </View>
  );
}
