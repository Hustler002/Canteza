import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { paymentOf, type OrderWithItems } from '@canteza/api';
import {
  awaitingPayment,
  canStudentCancel,
  formatPaise,
  isTerminal,
  STUDENT_STATUS_LABEL,
  toAppError,
  type OrderStatus,
} from '@canteza/shared';
import {
  orderFilters,
  useCreateReview,
  useOrder,
  useOrderReview,
  useOrdersRealtime,
  usePayForOrder,
  useTransitionOrder,
} from '../../../src/lib/queries';
import { confirm, notify } from '../../../src/lib/dialog';
import { useIdentity } from '../../../src/lib/session';
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
import { MoneyRow, OrderLines, ProgressTrail } from '../../../src/components/order';
import { AppBar, CardTitle, Divider, Icon } from '../../../src/components/patterns';
import { ReorderButton } from '../../../src/components/reorder';
import { FadeIn } from '../../../src/components/motion';
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
  const { id, confirming } = useLocalSearchParams<{ id: string; confirming?: string }>();
  const orderId = id ?? '';
  const transition = useTransitionOrder();

  // Set when the Razorpay sheet reported the student finished paying -- on checkout (the
  // route param) or here. It is a hint to wait for the webhook, never a claim of payment.
  const [confirmingSince, setConfirmingSince] = useState<number | null>(() =>
    confirming ? Date.now() : null,
  );
  const order = useOrder(orderId, (current) =>
    confirmingSince !== null && (!current || awaitingPayment(current.status, paymentOf(current)))
      ? CONFIRM_POLL_MS
      : false,
  );

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
        <AppBar title="Order" onBack={() => router.replace('/')} />
        <EmptyState title="Order not found" body="It may belong to another account." />
      </Screen>
    );
  }

  const data = order.data;
  const status = data.status as OrderStatus;
  const cancellable = canStudentCancel(status);
  const payment = paymentOf(data);
  const prepaid = payment !== null && payment.method !== 'cod';

  function cancel() {
    confirm({
      title: 'Cancel this order?',
      message: 'The canteen has not started cooking yet.',
      cancelLabel: 'Keep it',
      confirmLabel: 'Cancel order',
      destructive: true,
      onConfirm: () =>
        transition.mutate(
          { orderId, to: 'cancelled', reason: 'cancelled by student' },
          {
            onError: (err) =>
              // The canteen may have accepted in the same second; that is a real
              // outcome, not a glitch, so it is said plainly.
              notify('Could not cancel', toAppError(err).userMessage),
          },
        ),
    });
  }

  return (
    <Screen scroll>
      <AppBar
        title={data.code}
        subtitle={data.canteen_name_snapshot ?? undefined}
        onBack={() => router.replace('/')}
      />

      {/*
       * First, because until it is settled nothing else on this screen is going to
       * happen: an unpaid prepaid order is invisible to the kitchen.
       */}
      {awaitingPayment(status, payment) ? (
        <PaymentPanel
          order={data}
          confirmingSince={confirmingSince}
          onSubmitted={() => setConfirmingSince(Date.now())}
        />
      ) : null}

      <StatusHero status={status} canteen={data.canteen_name_snapshot} />

      {!isTerminal(status) ? (
        <Card>
          <ProgressTrail status={data.status} />
        </Card>
      ) : null}

      {/*
       * The destination, said the way a delivery partner would read it aloud and
       * big enough to check from across a room (§11). It stays above the receipt
       * because "where is it going" is asked far more often than "what did it cost".
       */}
      <Card>
        <CardTitle
          icon="location-outline"
          title={data.hostel_label}
          subtitle={`Block ${data.block} · Room ${data.room}`}
        />
        {data.delivery_note ? (
          <View
            style={{
              flexDirection: 'row',
              gap: t.space.sm,
              padding: t.space.md,
              borderRadius: t.radius.md,
              backgroundColor: t.color.surfaceAlt,
            }}
          >
            <Icon name="chatbubble-ellipses-outline" size={16} color={t.color.textMuted} />
            <Body muted>“{data.delivery_note}”</Body>
          </View>
        ) : null}
      </Card>

      <Card>
        <CardTitle
          icon="receipt-outline"
          title="Your order"
          subtitle={data.canteen_name_snapshot ?? undefined}
        />
        <OrderLines items={data.order_items ?? []} />
        <Divider dashed />
        <MoneyRow label="Item total" amountPaise={data.subtotal_paise} />
        {data.discount_paise > 0 ? (
          <MoneyRow label="Discount" amountPaise={-data.discount_paise} />
        ) : null}
        <MoneyRow label="Delivery to your room" amountPaise={data.delivery_fee_paise} />
        <Divider dashed />
        <MoneyRow label="Total" amountPaise={data.total_paise} strong />
        {!prepaid ? (
          <Badge label={`Pay ${formatPaise(data.total_paise)} in cash on delivery`} tone="info" />
        ) : payment.status === 'success' ? (
          <Badge label="✓ Paid online" tone="success" />
        ) : payment.status === 'refunded' ? (
          <Badge label="Refunded" tone="info" />
        ) : refundOwed(payment.failure_reason) ? (
          // `record_payment_result` writes this when money is captured for an order that
          // was already cancelled. The student was charged; saying nothing would be worse.
          <Badge label="Payment received after cancelling — it will be refunded" tone="info" />
        ) : null}
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
          icon="close-circle-outline"
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
        icon="help-buoy-outline"
        label="Report a problem"
        variant="ghost"
        onPress={() => router.push(`/support?order=${orderId}`)}
      />
    </Screen>
  );
}

/** How often the tracker re-reads while waiting on the webhook, if realtime is quiet. */
const CONFIRM_POLL_MS = 3000;

/**
 * How long "confirming" is shown before the screen offers to pay again. Razorpay's
 * webhook normally lands in a few seconds; past this, a declined attempt the sheet did
 * not report, or a webhook that is not arriving, is likelier than a slow one.
 */
const CONFIRM_PATIENCE_MS = 45_000;

/** End a provider's message with exactly one terminal punctuation mark. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The marker `record_payment_result` leaves when a capture lands on a closed order. */
function refundOwed(reason: string | null | undefined): boolean {
  return Boolean(reason?.includes('refund required'));
}

/**
 * The money, while it is still owed.
 *
 * Three states, all read from the server: confirming (the sheet said done, the webhook
 * has not landed), failed (the webhook said declined), and not started. The last two
 * look the same to a student -- the order is saved and the kitchen cannot see it -- so
 * they share a button. Paying again reuses the same Razorpay order, so it is one bill
 * however many attempts it takes.
 */
function PaymentPanel({
  order,
  confirmingSince,
  onSubmitted,
}: {
  order: OrderWithItems;
  confirmingSince: number | null;
  onSubmitted: () => void;
}) {
  const pay = usePayForOrder();
  const [error, setError] = useState<string | null>(null);
  const [impatient, setImpatient] = useState(false);
  const payment = paymentOf(order);

  useEffect(() => {
    setImpatient(false);
    if (confirmingSince === null) return;
    const remaining = CONFIRM_PATIENCE_MS - (Date.now() - confirmingSince);
    if (remaining <= 0) {
      setImpatient(true);
      return;
    }
    const timer = setTimeout(() => setImpatient(true), remaining);
    return () => clearTimeout(timer);
  }, [confirmingSince]);

  const failed = payment?.status === 'failed';
  const confirming = confirmingSince !== null && !failed && !impatient;

  function payNow() {
    setError(null);
    pay.mutate(order.id, {
      onSuccess: (result) => {
        if (result.kind === 'submitted') onSubmitted();
      },
      onError: (cause) => setError(toAppError(cause).userMessage),
    });
  }

  if (confirming) {
    return (
      <Card>
        <Badge label="Confirming payment…" tone="info" />
        <Body>
          This usually takes a few seconds. Your order goes to the kitchen as soon as the bank
          confirms it.
        </Body>
      </Card>
    );
  }

  return (
    <Card>
      <Heading level="heading">{failed ? 'Payment failed' : 'Payment not completed'}</Heading>
      <Body muted>
        {/*
         * Razorpay's reasons are full sentences that already end in a full stop ("…
         * Try another payment method."), so one is added only when it is missing.
         */}
        {failed && payment?.failure_reason ? `${sentence(payment.failure_reason)} ` : ''}
        Your order is saved, but the canteen cannot see it until it is paid.
      </Body>
      {impatient && !failed ? (
        <Body muted>
          Still waiting to hear from the bank. If money has left your account, this updates by
          itself.
        </Body>
      ) : null}
      <FormError message={error} />
      <Button
        label={`Pay ${formatPaise(order.total_paise)}`}
        onPress={payNow}
        loading={pay.isPending}
      />
    </Card>
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
      // The card swapping to this IS the success feedback (§13): the rating cannot
      // be sent twice, so a dismissible toast would vanish and leave the student
      // wondering whether it saved. This persists.
      <Card>
        <Badge label="✓ Thanks — rating saved" tone="success" />
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
        multiline
        maxLength={280}
        hint="Only the canteen and an admin will read this."
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
          <Icon
            name={star <= value ? 'star' : 'star-outline'}
            size={22}
            color={star <= value ? t.color.primary : t.color.textMuted}
          />
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

/**
 * What is happening, in words and one picture, at the top of the tracker. The trail
 * below says where the order is on its path; this says what that means for the student
 * right now. Wording only -- the status itself, and what may happen next, still come
 * from the state machine in packages/shared.
 */
const STATUS_STORY: Record<OrderStatus, { emoji: string; line: string }> = {
  pending: { emoji: '⏳', line: 'The canteen will accept it in a moment.' },
  accepted: { emoji: '👨‍🍳', line: 'The kitchen has your order.' },
  preparing: { emoji: '🍳', line: 'Your food is being cooked right now.' },
  ready: { emoji: '📦', line: 'Packed and waiting at the counter.' },
  assigned: { emoji: '🛵', line: 'A delivery partner is heading to the counter.' },
  picked_up: { emoji: '🛵', line: 'On its way to your room.' },
  delivered: { emoji: '✅', line: 'Delivered. Enjoy your meal!' },
  cancelled: { emoji: '✖️', line: 'This order was cancelled.' },
  rejected: { emoji: '✖️', line: 'The canteen could not take this order.' },
};

function StatusHero({ status, canteen }: { status: OrderStatus; canteen: string | null }) {
  const t = useTheme();
  const story = STATUS_STORY[status];
  const failed = status === 'cancelled' || status === 'rejected';
  const done = status === 'delivered';
  const soft = failed ? t.color.dangerSoft : done ? t.color.successSoft : t.color.primarySoft;
  const strong = failed ? t.color.danger : done ? t.color.success : t.color.primary;

  return (
    <FadeIn>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.lg }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 64,
            height: 64,
            borderRadius: t.radius.lg,
            backgroundColor: soft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 30 }}>{story?.emoji ?? '🍽️'}</Text>
        </View>
        <View style={{ flex: 1, gap: t.space.xxs }}>
          <Text style={[t.font.overline, { color: strong }]}>
            {canteen ? canteen.toUpperCase() : 'YOUR ORDER'}
          </Text>
          <Text style={[t.font.title, { color: t.color.text }]}>
            {STUDENT_STATUS_LABEL[status] ?? status}
          </Text>
          {story ? (
            <Text style={[t.font.body, { color: t.color.textMuted }]}>{story.line}</Text>
          ) : null}
        </View>
      </Card>
    </FadeIn>
  );
}
