import { View } from 'react-native';
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

/** The student's progress tracker. Failure states are shown as a pill, not a trail. */
export function ProgressTrail({ status }: { status: string }) {
  const t = useTheme();
  const current = progressIndex(status as OrderStatus);
  if (current < 0) return null;

  return (
    <View style={{ gap: t.space.sm }}>
      <View style={{ flexDirection: 'row', gap: t.space.xs }}>
        {STUDENT_PROGRESS_STEPS.map((step, index) => (
          <View
            key={step}
            style={{
              flex: 1,
              height: 6,
              borderRadius: t.radius.pill,
              backgroundColor: index <= current ? t.color.primary : t.color.surfaceAlt,
            }}
          />
        ))}
      </View>
      <Body muted>
        Step {current + 1} of {STUDENT_PROGRESS_STEPS.length}
      </Body>
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
