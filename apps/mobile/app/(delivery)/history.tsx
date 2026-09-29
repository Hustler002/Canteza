import { FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { BRAND, formatPaise, toAppError } from '@canteza/shared';
import { useDeliveryHistory } from '../../src/lib/queries';
import { useIdentity } from '../../src/lib/session';
import {
  Body,
  Card,
  EmptyState,
  ErrorState,
  Heading,
  Loading,
  Screen,
  columnStyle,
} from '../../src/components/ui';
import { AppBar, Fact, Icon, type IconName } from '../../src/components/patterns';
import { FadeIn } from '../../src/components/motion';
import { useTheme } from '../../src/theme';

/**
 * Completed deliveries.
 *
 * Counts, not money. The canteen employs and pays its delivery staff (ADR 008), so
 * the platform does not know the rate and will not invent one — a rupee figure here
 * would be a guess the partner might plan their week around.
 */
export default function DeliveryHistory() {
  const t = useTheme();
  const identity = useIdentity();
  const history = useDeliveryHistory(identity.userId);

  if (history.isLoading) return <Loading label="Loading your history…" />;
  if (history.isError) {
    return (
      <ErrorState
        message={toAppError(history.error).userMessage}
        onRetry={() => void history.refetch()}
      />
    );
  }

  const stats = history.data?.stats;
  const orders = history.data?.orders ?? [];

  return (
    <Screen padded={false}>
      <View style={[columnStyle(t), { padding: t.space.lg, paddingBottom: 0, gap: t.space.md }]}>
        <AppBar
          title="Your record"
          subtitle="Every delivery you have completed"
          onBack={() => router.replace('/deliveries')}
        />

        <View style={{ flexDirection: 'row', gap: t.space.md }}>
          <Stat icon="today-outline" label="Today" value={String(stats?.today ?? 0)} />
          <Stat icon="calendar-outline" label="This week" value={String(stats?.week ?? 0)} />
          <Stat icon="trophy-outline" label="All time" value={String(stats?.total ?? 0)} />
        </View>

        {stats?.averageMinutes !== null && stats?.averageMinutes !== undefined ? (
          <Body muted>Average {stats.averageMinutes} minutes from order placed to delivered.</Body>
        ) : null}

        <Body muted>
          Your canteen pays you directly, so {BRAND.name} counts deliveries rather than guessing
          your earnings.
        </Body>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(order) => order.id}
        contentContainerStyle={[columnStyle(t), { padding: t.space.lg, gap: t.space.md }]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <FadeIn index={index}>
            <Card padding="md">
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}
              >
                <Heading level="heading">{item.code}</Heading>
                <Text style={[t.font.caption, { color: t.color.textMuted }]}>
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Fact
                icon="navigate-outline"
                label={`${item.canteen_name_snapshot} → ${item.hostel_label} ${item.block}-${item.room}`}
              />
              <Fact icon="cash-outline" label={`${formatPaise(item.total_paise)} collected`} />
            </Card>
          </FadeIn>
        )}
        ListEmptyComponent={
          <EmptyState
            emoji="📦"
            title="No deliveries yet"
            body="Completed deliveries show up here with the date and destination."
          />
        }
        refreshing={history.isFetching}
        onRefresh={() => void history.refetch()}
      />
    </Screen>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, gap: t.space.xs }} padding="md">
      <Icon name={icon} size={18} color={t.color.primary} />
      <Heading level="display">{value}</Heading>
      <Text style={[t.font.caption, { color: t.color.textMuted }]}>{label}</Text>
    </Card>
  );
}
