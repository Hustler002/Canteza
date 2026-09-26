import { FlatList, View } from 'react-native';
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
} from '../../src/components/ui';
import { AppBar } from '../../src/components/patterns';
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
      <View style={{ padding: t.space.lg, paddingBottom: 0, gap: t.space.md }}>
        <AppBar
          title="Your record"
          subtitle="Every delivery you have completed"
          onBack={() => router.replace('/deliveries')}
        />

        <View style={{ flexDirection: 'row', gap: t.space.md }}>
          <Stat label="Today" value={String(stats?.today ?? 0)} />
          <Stat label="This week" value={String(stats?.week ?? 0)} />
          <Stat label="All time" value={String(stats?.total ?? 0)} />
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
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
        renderItem={({ item }) => (
          <Card>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}
            >
              <Heading level="heading">{item.code}</Heading>
              <Body muted>{new Date(item.created_at).toLocaleDateString()}</Body>
            </View>
            <Body muted>
              {item.canteen_name_snapshot} → {item.hostel_label} {item.block}-{item.room}
            </Body>
            <Body muted>{formatPaise(item.total_paise)} collected</Body>
          </Card>
        )}
        ListEmptyComponent={
          <EmptyState
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1 }}>
      <Body muted>{label}</Body>
      <Heading level="display">{value}</Heading>
    </Card>
  );
}
