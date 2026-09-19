import { Alert, FlatList, Pressable, View } from 'react-native';
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
import { useIdentity, useSession } from '../../src/lib/session';
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
} from '../../src/components/ui';
import { StatusPill } from '../../src/components/order';
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
  const { signOut } = useSession();

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
          title="Waiting for setup"
          body="This account is not linked to a canteen yet. An admin needs to finish onboarding it."
        />
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Screen>
    );
  }

  const carrying = active.data ?? [];
  const waiting = queue.data ?? [];

  return (
    <Screen padded={false}>
      <View style={{ padding: t.space.lg, paddingBottom: 0, gap: t.space.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
          <Heading level="display">Deliveries</Heading>
          <View style={{ flexDirection: 'row', gap: t.space.sm }}>
            <Button label="Record" variant="secondary" onPress={() => router.push('/history')} />
            <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
          </View>
        </View>

        <ShiftSwitch
          online={online}
          busy={shift.setOnline.isPending || shift.query.isLoading}
          carrying={carrying.length}
          onToggle={(next) =>
            shift.setOnline.mutate(next, {
              onError: (err) => Alert.alert('Could not change shift', toAppError(err).userMessage),
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
          contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
          renderItem={({ item }) => <DeliveryCard order={item} />}
          ListHeaderComponent={
            carrying.length > 0 ? (
              <Heading level="heading">Carrying now ({carrying.length})</Heading>
            ) : null
          }
          ListEmptyComponent={
            online ? (
              <EmptyState
                title="Nothing waiting"
                body="Orders appear the moment your canteen marks one ready."
              />
            ) : (
              <EmptyState
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
      style={({ pressed }) => ({
        minHeight: t.minTouchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        borderRadius: t.radius.lg,
        backgroundColor: online ? t.color.successSoft : t.color.surfaceAlt,
        opacity: pressed || busy ? 0.75 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <Body>{online ? 'On shift' : 'Off shift'}</Body>
        <Body muted>
          {online
            ? 'You can see and take orders.'
            : carrying > 0
              ? 'You can still finish what you are carrying.'
              : 'Tap to start taking orders.'}
        </Body>
      </View>
      <Badge label={online ? 'ONLINE' : 'OFFLINE'} tone={online ? 'success' : 'neutral'} />
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
      onError: (err) => Alert.alert('Could not take it', toAppError(err).userMessage),
    });
  }

  return (
    <Pressable
      onPress={() => !unclaimed && router.push(`/delivery/${order.id}`)}
      disabled={unclaimed}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={unclaimed ? {} : { borderColor: t.color.primary }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
          <Heading level="title">{order.code}</Heading>
          <StatusPill status={order.status} />
        </View>

        <Body muted>{order.canteen_name_snapshot}</Body>

        <Heading level="heading">
          {order.hostel_label} · {order.block}-{order.room}
        </Heading>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
          <Body muted>
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </Body>
          <Body muted>Collect {formatPaise(order.total_paise)} cash</Body>
        </View>

        {unclaimed ? (
          <Button label="Take this delivery" onPress={onClaim} loading={claim.isPending} />
        ) : (
          <Button
            label="Open"
            variant="secondary"
            onPress={() => router.push(`/delivery/${order.id}`)}
          />
        )}
      </Card>
    </Pressable>
  );
}
