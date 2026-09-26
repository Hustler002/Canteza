import { Text, View } from 'react-native';
import type { OrderItem } from '@canteza/api';
import {
  formatPaise,
  progressIndex,
  STUDENT_PROGRESS_STEPS,
  STUDENT_STATUS_LABEL,
  type OrderStatus,
} from '@canteza/shared';
import { Badge, Body } from './ui';
import { useTheme } from '../theme';

/**
 * Order presentation shared by the student tracker and the canteen board.
 *
 * Labels and step order come from packages/shared, so a status added to the state
 * machine cannot show up here as a raw database string.
 */

const TONE: Record<OrderStatus, 'neutral' | 'primary' | 'success' | 'danger' | 'info'> = {
  pending: 'primary',
  accepted: 'info',
  preparing: 'info',
  ready: 'primary',
  assigned: 'info',
  picked_up: 'info',
  delivered: 'success',
  cancelled: 'danger',
  rejected: 'danger',
};

export function StatusPill({ status }: { status: string }) {
  const known = status as OrderStatus;
  const label = STUDENT_STATUS_LABEL[known] ?? status;
  return <Badge label={label} tone={TONE[known] ?? 'neutral'} />;
}

/**
 * The student's progress tracker. Failure states are shown as a pill, not a trail.
 *
 * A vertical timeline rather than the segmented bar this replaced, because "step 4
 * of 6" answers none of the three questions a waiting student actually has (§11):
 * what happened, what is happening now, what happens next. Each step names itself,
 * done steps are ticked, the current one is filled and bold, and the rest stay
 * visibly ahead.
 *
 * The steps and their labels come from `packages/shared`, so a status added to the
 * state machine cannot appear here as a raw database string.
 */
export function ProgressTrail({ status }: { status: string }) {
  const t = useTheme();
  const current = progressIndex(status as OrderStatus);
  if (current < 0) return null;

  return (
    <View style={{ gap: 0 }}>
      {STUDENT_PROGRESS_STEPS.map((step, index) => {
        const done = index < current;
        const now = index === current;
        const last = index === STUDENT_PROGRESS_STEPS.length - 1;
        const reached = done || now;

        return (
          <View key={step} style={{ flexDirection: 'row', gap: t.space.md }}>
            {/* The rail: a dot per step, joined by a line that is only coloured
             * as far as the order has actually travelled. */}
            <View style={{ alignItems: 'center', width: 20 }}>
              <View
                style={{
                  width: now ? 16 : 12,
                  height: now ? 16 : 12,
                  borderRadius: t.radius.pill,
                  borderWidth: reached ? 0 : 2,
                  borderColor: t.color.border,
                  backgroundColor: reached ? t.color.primary : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 2,
                }}
              >
                {done ? (
                  <Text style={{ color: t.color.onPrimary, fontSize: 8, fontWeight: '900' }}>
                    ✓
                  </Text>
                ) : null}
              </View>
              {!last ? (
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    minHeight: t.space.xl,
                    backgroundColor: done ? t.color.primary : t.color.border,
                  }}
                />
              ) : null}
            </View>

            <View style={{ flex: 1, paddingBottom: last ? 0 : t.space.lg }}>
              <Text
                style={[
                  now ? t.font.heading : t.font.body,
                  {
                    color: reached ? t.color.text : t.color.textMuted,
                  },
                ]}
              >
                {STUDENT_STATUS_LABEL[step]}
              </Text>
              {now ? (
                <Text style={[t.font.caption, { color: t.color.primary, marginTop: 2 }]}>
                  Happening now
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Line items from the order's own snapshot — never joined to the live menu, so an
 * old receipt keeps the name and price that were actually charged (ADR 003).
 */
export function OrderLines({ items }: { items: OrderItem[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.sm }}>
      {items.map((item) => (
        <View
          key={item.id}
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}
        >
          <Body>
            {item.quantity} × {item.name_snapshot}
          </Body>
          <Body muted>{formatPaise(item.line_total_paise)}</Body>
        </View>
      ))}
    </View>
  );
}

export function MoneyRow({
  label,
  amountPaise,
  strong = false,
}: {
  label: string;
  amountPaise: number;
  strong?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
      <Body muted={!strong}>{label}</Body>
      <Body muted={!strong}>{formatPaise(amountPaise)}</Body>
    </View>
  );
}
