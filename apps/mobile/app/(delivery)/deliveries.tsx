import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { isAwaitingOnboarding, type OrderWithItems } from '@canteza/api';
import { formatPaise, toAppError } from '@canteza/shared';
import {
  orderFilters,
  useActiveDeliveries,
  useClaimDelivery,
  useDeliveryQueue,
  useOrdersRealtime,
  useShift,
} from '../../src/lib/queries';
import { notify } from '../../src/lib/dialog';
import { useConfirmSignOut, useIdentity } from '../../src/lib/session';
import {
  Button,
  Card,
  columnStyle,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
} from '../../src/components/ui';
import { StatusPill } from '../../src/components/order';
import { AppBar, Fact, Icon, IconButton, SectionHeader } from '../../src/components/patterns';
import { BrandBar } from '../../src/components/logo';
import { FadeIn, webInteractive } from '../../src/components/motion';
import { useTheme } from '../../src/theme';

/**
 * The partner's main screen, used one-handed while walking.
 *
 * Two lists and one switch: what you are carrying, what is waiting, and whether you
 * are on shift. Everything is scoped to the partner's own canteen by RLS — there is
 * no canteen id anywhere in this file to get wrong.
 */
export default function Deliveries() {
  const t = useTheme();
  const identity = useIdentity();
  const confirmSignOut = useConfirmSignOut();

  const shift = useShift(identity.userId);
  const online = shift.query.data?.isOnline ?? false;

  const active = useActiveDeliveries(identity.userId);
  const queue = useDeliveryQueue(online);

  // The partner's own canteen; an event on any of its orders refreshes both lists.
  useOrdersRealtime(identity.canteenId ? orderFilters.forCanteen(identity.canteenId) : null);

  if (isAwaitingOnboarding(identity)) {
    return (
      <Screen>
        <EmptyState
          emoji="🛠️"
          title="Waiting for setup"
          body="This account is not linked to a canteen yet. An admin needs to finish onboarding it."
        />
        <Button label="Sign out" variant="secondary" onPress={confirmSignOut} />
      </Screen>
    );
  }

  const carrying = active.data ?? [];
  const waiting = queue.data ?? [];

  return (
    <Screen padded={false}>
      <View style={[columnStyle(t), { padding: t.space.lg, paddingBottom: 0, gap: t.space.md }]}>
        <BrandBar
          role="DELIVERY"
          right={
            <>
              <IconButton
                icon="stats-chart-outline"
                label="Your record"
                onPress={() => router.push('/history')}
              />
              <IconButton icon="log-out-outline" label="Sign out" onPress={confirmSignOut} />
            </>
          }
        />
        <AppBar title="Deliveries" subtitle={identity.profile.full_name ?? undefined} />

        <ShiftSwitch
          online={online}
          busy={shift.setOnline.isPending || shift.query.isLoading}
          carrying={carrying.length}
          onToggle={(next) =>
            shift.setOnline.mutate(next, {
              onError: (err) => notify('Could not change shift', toAppError(err).userMessage),
            })
          }
        />
      </View>

      {active.isError || queue.isError ? (
        <ErrorState
          message={toAppError(active.error ?? queue.error).userMessage}
          onRetry={() => {
            void active.refetch();
            void queue.refetch();
          }}
        />
      ) : active.isLoading ? (
        <Loading label="Loading your deliveries…" />
      ) : (
        <FlatList
          data={[...carrying, ...waiting]}
          keyExtractor={(order) => order.id}
          contentContainerStyle={[columnStyle(t), { padding: t.space.lg, gap: t.space.md }]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <FadeIn index={index}>
              <DeliveryCard order={item} />
            </FadeIn>
          )}
          ListHeaderComponent={
            carrying.length > 0 ? (
              <SectionHeader title={`Carrying now (${carrying.length})`} />
            ) : null
          }
          ListEmptyComponent={
            online ? (
              <EmptyState
                emoji="🛵"
                title="Nothing waiting"
                body="Orders appear the moment your canteen marks one ready."
              />
            ) : (
              <EmptyState
                emoji="😴"
                title="You are off shift"
                body="Go online to see orders waiting at your canteen."
              />
            )
          }
          refreshing={active.isFetching || queue.isFetching}
          onRefresh={() => {
            void active.refetch();
            void queue.refetch();
          }}
        />
      )}
    </Screen>
  );
}

function ShiftSwitch({
  online,
  busy,
  carrying,
  onToggle,
}: {
  online: boolean;
  busy: boolean;
  carrying: number;
  onToggle: (next: boolean) => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onToggle(!online)}
      disabled={busy}
      accessibilityRole="switch"
      accessibilityState={{ checked: online, disabled: busy }}
      accessibilityLabel={online ? 'Go off shift' : 'Go on shift'}
      style={({ pressed }) => [
        {
          minHeight: t.minTouchTarget,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: t.space.md,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.md,
          borderRadius: t.radius.lg,
          borderWidth: 1.5,
          borderColor: online ? t.color.success : t.color.cardBorder,
          backgroundColor: online ? t.color.successSoft : t.color.surface,
          opacity: busy ? 0.7 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        t.elevation.card,
        webInteractive(t.motion.quick),
      ]}
    >
      <View style={{ flex: 1, gap: t.space.xxs }}>
        <Text style={[t.font.heading, { color: t.color.text }]}>
          {online ? 'You are on shift' : 'You are off shift'}
        </Text>
        <Text style={[t.font.caption, { color: t.color.textMuted }]}>
          {online
            ? 'You can see and take orders.'
            : carrying > 0
              ? 'You can still finish what you are carrying.'
              : 'Tap to start taking orders.'}
        </Text>
      </View>
      {/* A drawn switch: the whole row is the control, this shows its state. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 52,
          height: 30,
          borderRadius: 15,
          padding: 3,
          backgroundColor: online ? t.color.success : t.color.border,
          alignItems: online ? 'flex-end' : 'flex-start',
        }}
      >
        <View
          style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: t.color.onPrimary }}
        />
      </View>
    </Pressable>
  );
}

function DeliveryCard({ order }: { order: OrderWithItems }) {
  const t = useTheme();
  const claim = useClaimDelivery();
  const unclaimed = order.delivery_partner_id === null;
  const itemCount = (order.order_items ?? []).reduce((sum, item) => sum + item.quantity, 0);

  function onClaim() {
    claim.mutate(order.id, {
      // Two partners can tap at the same instant. The loser is told plainly; the
      // list refreshes either way, so the order simply stops being offered.
      onError: (err) => notify('Could not take it', toAppError(err).userMessage),
    });
  }

  return (
    <Pressable
      onPress={() => !unclaimed && router.push(`/delivery/${order.id}`)}
      disabled={unclaimed}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card highlight={!unclaimed}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <View style={{ flex: 1, gap: t.space.xxs }}>
            <Text style={[t.font.title, { color: t.color.text }]}>{order.code}</Text>
            <Fact icon="storefront-outline" label={order.canteen_name_snapshot ?? 'Canteen'} />
          </View>
          <StatusPill status={order.status} />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.sm,
            padding: t.space.md,
            borderRadius: t.radius.md,
            backgroundColor: t.color.primarySoft,
          }}
        >
          <Icon name="location" size={18} color={t.color.primary} />
          <Text style={[t.font.heading, { color: t.color.text, flex: 1 }]}>
            {order.hostel_label} · {order.block}-{order.room}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
          <Fact icon="fast-food-outline" label={`${itemCount} item${itemCount === 1 ? '' : 's'}`} />
          <Fact
            icon="cash-outline"
            label={`Collect ${formatPaise(order.total_paise)} cash`}
            strong
          />
        </View>

        {unclaimed ? (
          <Button
            icon="hand-left-outline"
            label="Take this delivery"
            onPress={onClaim}
            loading={claim.isPending}
          />
        ) : (
          <Button
            icon="navigate-outline"
            label="Open delivery"
            variant="secondary"
            onPress={() => router.push(`/delivery/${order.id}`)}
          />
        )}
      </Card>
    </Pressable>
  );
}
