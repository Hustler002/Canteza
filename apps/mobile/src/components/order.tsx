import { Text, View } from 'react-native';
import type { OrderItem } from '@canteza/api';
import {
  formatPaise,
  progressIndex,
  STUDENT_PROGRESS_STEPS,
  STUDENT_STATUS_LABEL,
  type OrderStatus,
} from '@canteza/shared';
import { Badge } from './ui';
import { Icon } from './patterns';
import { useTheme } from '../theme';

/**
 * Order presentation shared by the student tracker and the canteen board.
 *
 * Labels and step order come from packages/shared, so a status added to the state
 * machine cannot show up here as a raw database string.
 */

const TONE: Record<OrderStatus, 'neutral' | 'primary' | 'success' | 'danger' | 'info' | 'warning'> =
  {
    pending: 'warning',
    accepted: 'info',
    preparing: 'info',
    ready: 'primary',
    assigned: 'info',
    picked_up: 'primary',
    delivered: 'success',
    cancelled: 'danger',
    rejected: 'danger',
  };

export function StatusPill({ status }: { status: string }) {
  const known = status as OrderStatus;
  const label = STUDENT_STATUS_LABEL[known] ?? status;
  return <Badge dot label={label} tone={TONE[known] ?? 'neutral'} />;
}

/**
 * The student's progress tracker. Failure states are shown as a pill, not a trail.
 *
 * A vertical timeline rather than the segmented bar this replaced, because "step 4
 * of 6" answers none of the three questions a waiting student actually has (§11):
 * what happened, what is happening now, what happens next. Each step names itself,
 * done steps are ticked, the current one is ringed and bold, and the rest stay
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
    <View>
      {STUDENT_PROGRESS_STEPS.map((step, index) => {
        const done = index < current;
        const now = index === current;
        const last = index === STUDENT_PROGRESS_STEPS.length - 1;
        const reached = done || now;

        return (
          <View key={step} style={{ flexDirection: 'row', gap: t.space.md }}>
            {/* The rail: a marker per step, joined by a line that is only coloured
             * as far as the order has actually travelled. */}
            <View style={{ alignItems: 'center', width: 24 }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  borderWidth: now ? 3 : reached ? 0 : 2,
                  borderColor: now ? t.color.primaryTint : t.color.border,
                  backgroundColor: done ? t.color.primary : now ? t.color.primary : t.color.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {done ? <Icon name="checkmark" size={14} color={t.color.onPrimary} /> : null}
                {now ? (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: t.color.onPrimary,
                    }}
                  />
                ) : null}
              </View>
              {!last ? (
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    minHeight: t.space.xl,
                    borderRadius: 1,
                    backgroundColor: done ? t.color.primary : t.color.border,
                  }}
                />
              ) : null}
            </View>

            <View style={{ flex: 1, paddingBottom: last ? 0 : t.space.lg, paddingTop: 1 }}>
              <Text
                style={[
                  now ? t.font.heading : t.font.body,
                  { color: reached ? t.color.text : t.color.textMuted },
                ]}
              >
                {STUDENT_STATUS_LABEL[step]}
              </Text>
              {now ? (
                <Text style={[t.font.caption, { color: t.color.primary, marginTop: t.space.xxs }]}>
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
        <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <View
            style={{
              minWidth: 30,
              paddingHorizontal: t.space.xs,
              paddingVertical: t.space.xxs,
              borderRadius: 6,
              backgroundColor: t.color.surfaceAlt,
              alignItems: 'center',
            }}
          >
            <Text style={[t.font.caption, { color: t.color.text, fontWeight: '700' }]}>
              {item.quantity}×
            </Text>
          </View>
          <Text style={[t.font.body, { color: t.color.text, flex: 1 }]}>{item.name_snapshot}</Text>
          <Text style={[t.font.price, { color: t.color.textMuted, fontWeight: '600' }]}>
            {formatPaise(item.line_total_paise)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One line of a bill. `strong` is the total -- larger and in full ink; a negative
 * amount (a discount) is shown in green, because money coming off the bill should read
 * as good news at a glance.
 */
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
  const saving = amountPaise < 0;
  const color = strong ? t.color.text : saving ? t.color.success : t.color.textMuted;
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: t.space.md,
      }}
    >
      <Text style={[strong ? t.font.heading : t.font.body, { color }]}>{label}</Text>
      <Text
        style={[
          strong ? t.font.priceLg : t.font.price,
          { color, fontWeight: strong ? '800' : '500' },
        ]}
      >
        {formatPaise(amountPaise)}
      </Text>
    </View>
  );
}
