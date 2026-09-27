import type { Row } from '@canteza/shared';
import type { CampusClient } from './client';
import { unwrap, unwrapList } from './errors';

/**
 * The notification inbox.
 *
 * `notify_order` has written a row per transition since Phase 2 and nothing has ever
 * read them — this is the reader. Everything it needs already exists: RLS scopes the
 * table to its owner (`notifications_own`), and `read_at` is the single column a
 * client may write (`grant update (read_at)`), so marking one read cannot touch
 * whose it is or what it says.
 *
 * **The row stores no text.** It holds `(audience, status, order_id)` and the wording
 * is rendered from `orderNotification()` in `packages/shared`, which is the same
 * function push will use — so the two cannot drift, and rewording a message ships
 * without a migration or a backfill.
 */

/**
 * The order fields the renderer needs, embedded.
 *
 * `orders_read` scopes the embed exactly as it scopes a direct select, so a
 * notification whose order the caller may not read comes back with `orders: null`
 * rather than leaking a code — which is why the screen tolerates that case instead
 * of assuming it away.
 */
export type NotificationWithOrder = Row<'notifications'> & {
  orders: Pick<Row<'orders'>, 'code' | 'canteen_name_snapshot' | 'hostel_label'> | null;
};

const WITH_ORDER = '*, orders ( code, canteen_name_snapshot, hostel_label )';

export async function listNotifications(
  client: CampusClient,
  limit = 50,
): Promise<NotificationWithOrder[]> {
  return unwrapList(
    client
      .from('notifications')
      .select(WITH_ORDER)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as Promise<NotificationWithOrder[]>;
}

/**
 * How many are unread.
 *
 * `head: true` with an exact count returns the number and no rows at all, which is
 * what a badge needs — fetching fifty rows to render a "3" would be the expensive
 * way to learn one integer. There is a partial index on exactly this predicate.
 */
export async function countUnreadNotifications(client: CampusClient): Promise<number> {
  const { count, error } = await client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (error) throw error;
  return count ?? 0;
}

/** Marking read is idempotent: a row already read keeps its original timestamp. */
export async function markNotificationRead(
  client: CampusClient,
  notificationId: string,
): Promise<void> {
  await unwrap(
    client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .is('read_at', null)
      .select('id'),
  );
}

/**
 * Mark everything read.
 *
 * No user id in the filter: `notifications_own` is what limits the update to the
 * caller's own rows, and restating it here would be a second copy of a rule the
 * database already enforces (rule 15). `is('read_at', null)` is not a safety filter
 * but a courtesy — it keeps the original timestamps on rows already read.
 */
export async function markAllNotificationsRead(client: CampusClient): Promise<void> {
  await unwrap(
    client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null)
      .select('id'),
  );
}

/**
 * Push: tell the server this device belongs to the signed-in person.
 *
 * An RPC rather than an insert, because a device that someone else used last must be
 * taken from them, and no policy may let a client write a row it does not own. Called on
 * every app start; the same token and person just refresh `last_seen_at`.
 */
export async function registerPushToken(
  client: CampusClient,
  token: string,
  platform: 'android' | 'ios',
): Promise<void> {
  await unwrap(client.rpc('register_push_token', { p_token: token, p_platform: platform }));
}

/**
 * Stop pushing to this device. Run *before* signing out: it is the owner deleting their
 * own row, so it needs the session that is about to end.
 */
export async function unregisterPushToken(client: CampusClient, token: string): Promise<void> {
  await unwrap(client.from('push_tokens').delete().eq('token', token));
}
