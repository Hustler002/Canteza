import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import type { NotificationWithOrder } from '@canteza/api';
import {
  formatCampusDateTime,
  orderNotification,
  toAppError,
  type NotificationAudience,
  type OrderStatus,
} from '@canteza/shared';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useNotificationsRealtime,
  useUnreadNotificationCount,
} from '../../src/lib/queries';
import { useIdentity } from '../../src/lib/session';
import { Body, Card, EmptyState, ErrorState, Heading, Screen } from '../../src/components/ui';
import { AppBar, SkeletonList } from '../../src/components/patterns';
import { useTheme } from '../../src/theme';

/**
 * The notification inbox.
 *
 * `notify_order` has written a row for every transition since Phase 2 and nothing
 * has ever read them. This is that reader — the in-app half of Phase 8, and the half
 * that needs no native build, no FCM credentials and no Expo account.
 *
 * The file is `inbox.tsx` rather than `notifications.tsx` for the reason rule 19
 * exists: route groups do not appear in the URL, so if the counter or a partner ever
 * gets its own inbox, `(canteen)/notifications.tsx` would resolve to the same
 * `/notifications` and one would silently shadow the other. A distinct filename per
 * role group is the only thing that prevents it.
 */
export default function Inbox() {
  const t = useTheme();
  const identity = useIdentity();
  const notifications = useNotifications(identity.userId);
  const unread = useUnreadNotificationCount(identity.userId);
  const markAll = useMarkAllNotificationsRead();

  // `notifications` is already in the realtime publication, so this costs no schema
  // change — a row lands and the list and the badge both refresh.
  useNotificationsRealtime(identity.userId);

  if (notifications.isLoading) {
    return (
      <Screen>
        <AppBar title="Notifications" onBack={() => router.back()} />
        <SkeletonList rows={5} />
      </Screen>
    );
  }

  if (notifications.isError) {
    return (
      <ErrorState
        message={toAppError(notifications.error).userMessage}
        onRetry={() => void notifications.refetch()}
      />
    );
  }

  const rows = notifications.data ?? [];
  const unreadCount = unread.data ?? 0;

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.sm }}>
        <AppBar
          title="Notifications"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          onBack={() => router.back()}
          right={
            unreadCount > 0 ? (
              <Pressable
                onPress={() => markAll.mutate()}
                accessibilityRole="button"
                accessibilityLabel="Mark all as read"
                hitSlop={t.hitSlop}
              >
                <Body muted>Mark all</Body>
              </Pressable>
            ) : undefined
          }
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState title="Nothing yet" body="Updates about your orders will arrive here." />
        }
        renderItem={({ item }) => <NotificationRow row={item} />}
        refreshing={notifications.isFetching}
        onRefresh={() => void notifications.refetch()}
      />
    </Screen>
  );
}

function NotificationRow({ row }: { row: NotificationWithOrder }) {
  const t = useTheme();
  const markRead = useMarkNotificationRead();
  const unread = row.read_at === null;

  /*
   * The wording is rendered here, not stored. The row holds (audience, status) and
   * `orderNotification` turns it into a sentence — the same function push will call,
   * so the two can never say different things about one event.
   */
  const content = row.status
    ? orderNotification(row.audience as NotificationAudience, row.status as OrderStatus, {
        orderCode: row.orders?.code ?? 'your order',
        canteenName: row.orders?.canteen_name_snapshot ?? 'the canteen',
        hostelLabel: row.orders?.hostel_label ?? 'your room',
      })
    : null;

  // A status this audience has no wording for writes no row, so this is defensive
  // rather than expected — but a blank card would be worse than a plain one.
  if (!content) return null;

  function open() {
    if (unread) markRead.mutate(row.id);
    if (row.order_id) router.push(`/order/${row.order_id}`);
  }

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${content.title}. ${content.body}${unread ? '. Unread' : ''}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={unread ? { borderColor: t.color.primary, borderWidth: 1.5 } : { opacity: 0.75 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          {/* The dot repeats what the border says, so it is hidden from a screen
           * reader — "Unread" is already in the row's label above. */}
          {unread ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 8,
                height: 8,
                borderRadius: t.radius.pill,
                backgroundColor: t.color.primary,
              }}
            />
          ) : null}
          <Heading level="heading">{content.title}</Heading>
        </View>

        <Body muted>{content.body}</Body>
        <Body muted>{formatCampusDateTime(row.created_at)}</Body>
      </Card>
    </Pressable>
  );
}
