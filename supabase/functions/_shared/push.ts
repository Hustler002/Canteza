/**
 * The decisions `send-push` makes, apart from its I/O, so vitest runs the file Deno runs.
 *
 * `send-push` is fired by a Supabase Database Webhook on every INSERT into
 * `notifications`. It does not decide *whether* anyone is told anything -- `notify_order`
 * already decided that when it wrote the row, and the inbox shows the same row. Push is
 * a second delivery of a decision already made, which is why this file has no opinion
 * about statuses or audiences at all.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH_SIZE = 100;

/** The header the Database Webhook is configured to send, carrying PUSH_WEBHOOK_SECRET. */
export const PUSH_SECRET_HEADER = 'x-push-secret';

/** The columns of a `notifications` row this function reads. */
export type NotificationRecord = {
  id: string;
  user_id: string;
  audience: string;
  type: string;
  order_id: string | null;
  status: string | null;
};

/**
 * The row out of a Database Webhook payload, or null for anything that is not a new
 * order notification.
 *
 * The payload is `{ type, table, schema, record, old_record }`. Only INSERTs are pushed:
 * an UPDATE on this table is a student marking a notification read, and pushing that
 * back to their own phone would be absurd.
 */
export function readWebhookRecord(payload: unknown): NotificationRecord | null {
  if (!payload || typeof payload !== 'object') return null;
  const { type, table, record } = payload as {
    type?: unknown;
    table?: unknown;
    record?: Partial<NotificationRecord> | null;
  };
  if (type !== 'INSERT' || table !== 'notifications' || !record) return null;
  if (
    typeof record.id !== 'string' ||
    typeof record.user_id !== 'string' ||
    typeof record.audience !== 'string'
  ) {
    return null;
  }
  if (record.type !== 'order_status' || !record.order_id || !record.status) return null;

  return {
    id: record.id,
    user_id: record.user_id,
    audience: record.audience,
    type: record.type,
    order_id: record.order_id,
    status: record.status,
  };
}

/**
 * What a tapped notification carries back to the app. Ids only: the app refetches
 * everything it shows, so a push can never display a stale status as current.
 */
export type PushData = {
  notificationId: string;
  orderId: string;
  audience: string;
};

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: PushData;
  sound: 'default';
  channelId: string;
  priority: 'high';
};

/** One message per device, batched to Expo's limit. */
export function pushBatches(
  tokens: readonly string[],
  content: { title: string; body: string },
  data: PushData,
  channelId: string,
): ExpoPushMessage[][] {
  const messages = tokens.map((to): ExpoPushMessage => ({
    to,
    title: content.title,
    body: content.body,
    data,
    sound: 'default',
    channelId,
    // "high" is what makes Android show it as a heads-up banner rather than filing it
    // silently. An order update is exactly the thing worth interrupting for.
    priority: 'high',
  }));

  const batches: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    batches.push(messages.slice(i, i + EXPO_BATCH_SIZE));
  }
  return batches;
}

/**
 * Tokens Expo says will never work again, from one batch's response.
 *
 * Expo answers `{ data: [ticket, ...] }` with one ticket per message, **in the order
 * sent**, so a ticket is matched to its token by position. `DeviceNotRegistered` means
 * the app was uninstalled or the token rotated; that token is pruned so the next order
 * does not send into the void. Any other error -- a rate limit, a credentials problem --
 * says nothing about the device, and the token is kept.
 */
export function deadTokens(batch: readonly ExpoPushMessage[], response: unknown): string[] {
  const tickets = (response as { data?: unknown })?.data;
  if (!Array.isArray(tickets)) return [];

  const dead: string[] = [];
  tickets.forEach((ticket, index) => {
    const message = batch[index];
    if (!message) return;
    const detail = (ticket as { status?: string; details?: { error?: string } }) ?? {};
    if (detail.status === 'error' && detail.details?.error === 'DeviceNotRegistered') {
      dead.push(message.to);
    }
  });
  return dead;
}
