import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  notificationContext,
  orderNotification,
  ORDER_STATUSES,
  PUSH_CHANNEL,
  type NotificationAudience,
} from '@canteza/shared';
import * as generated from '../functions/_shared/notifications.generated';
import {
  deadTokens,
  EXPO_BATCH_SIZE,
  pushBatches,
  readWebhookRecord,
  type PushData,
} from '../functions/_shared/push';

/**
 * `send-push`, minus the network.
 *
 * The property that matters most is not in `push.ts` at all: **the lock screen must say
 * what the inbox says.** The inbox renders with `packages/shared`; the Deno function
 * renders with a generated copy of it. So the first block fails the moment the copy is
 * stale, and then checks every audience and status renders identically through both.
 */

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

describe('the wording push sends', () => {
  it('is an up-to-date copy of packages/shared — run `npm run functions:sync` if not', async () => {
    // A computed specifier, so TypeScript does not demand types for a plain .mjs script.
    const generator = root('scripts/sync-function-shared.mjs');
    const { generate } = (await import(/* @vite-ignore */ generator)) as {
      generate: (source: string) => string;
    };
    const source = readFileSync(root('packages/shared/src/notifications.ts'), 'utf8');
    const copy = readFileSync(
      root('supabase/functions/_shared/notifications.generated.ts'),
      'utf8',
    );
    expect(copy).toBe(generate(source));
  });

  it('renders every audience and status exactly as the inbox does', () => {
    const order = { code: '#101', canteen_name_snapshot: 'Main Canteen', hostel_label: 'Hostel 3' };
    const audiences: NotificationAudience[] = ['student', 'canteen', 'delivery'];
    for (const audience of audiences) {
      for (const status of ORDER_STATUSES) {
        expect(
          generated.orderNotification(audience, status, generated.notificationContext(order)),
          `${audience} / ${status}`,
        ).toEqual(orderNotification(audience, status, notificationContext(order)));
      }
    }
  });

  it('falls back the same way for an order the reader can no longer see', () => {
    expect(generated.notificationContext(null)).toEqual(notificationContext(null));
  });

  it('addresses the same Android channel the app creates', () => {
    expect(generated.PUSH_CHANNEL).toEqual(PUSH_CHANNEL);
  });
});

describe('readWebhookRecord', () => {
  const record = {
    id: 'n1',
    user_id: 'u1',
    audience: 'student',
    type: 'order_status',
    order_id: 'o1',
    status: 'accepted',
    read_at: null,
  };
  const payload = (over: object = {}) => ({
    type: 'INSERT',
    table: 'notifications',
    schema: 'public',
    record,
    old_record: null,
    ...over,
  });

  it('reads a new order notification', () => {
    expect(readWebhookRecord(payload())).toEqual({
      id: 'n1',
      user_id: 'u1',
      audience: 'student',
      type: 'order_status',
      order_id: 'o1',
      status: 'accepted',
    });
  });

  it('ignores an UPDATE, which is someone marking a notification read', () => {
    expect(readWebhookRecord(payload({ type: 'UPDATE' }))).toBeNull();
  });

  it('ignores any other table the webhook might be pointed at by mistake', () => {
    expect(readWebhookRecord(payload({ table: 'orders' }))).toBeNull();
  });

  it('ignores a row with no order or no status, which has nothing to say', () => {
    expect(readWebhookRecord(payload({ record: { ...record, order_id: null } }))).toBeNull();
    expect(readWebhookRecord(payload({ record: { ...record, status: null } }))).toBeNull();
    expect(readWebhookRecord(payload({ record: { ...record, type: 'promo' } }))).toBeNull();
  });

  it('ignores anything that is not a webhook payload at all', () => {
    for (const junk of [null, undefined, 'x', 42, {}, { type: 'INSERT' }]) {
      expect(readWebhookRecord(junk)).toBeNull();
    }
  });
});

const data: PushData = { notificationId: 'n1', orderId: 'o1', audience: 'student' };
const content = { title: 'Order accepted', body: 'Main Canteen is starting on #101.' };

describe('pushBatches', () => {
  it('sends one high-priority message per device, on the order channel', () => {
    const [batch] = pushBatches(
      ['ExponentPushToken[a]', 'ExponentPushToken[b]'],
      content,
      data,
      'orders',
    );
    expect(batch).toHaveLength(2);
    expect(batch![0]).toEqual({
      to: 'ExponentPushToken[a]',
      ...content,
      data,
      sound: 'default',
      channelId: 'orders',
      priority: 'high',
    });
  });

  it('splits at Expo’s limit of 100 per request', () => {
    const tokens = Array.from({ length: 250 }, (_, i) => `ExponentPushToken[${i}]`);
    const batches = pushBatches(tokens, content, data, 'orders');
    expect(batches.map((b) => b.length)).toEqual([EXPO_BATCH_SIZE, EXPO_BATCH_SIZE, 50]);
    expect(batches.flat().map((m) => m.to)).toEqual(tokens);
  });

  it('sends nothing to nobody', () => {
    expect(pushBatches([], content, data, 'orders')).toEqual([]);
  });
});

describe('deadTokens', () => {
  const [batch] = pushBatches(
    ['ExponentPushToken[live]', 'ExponentPushToken[gone]', 'ExponentPushToken[busy]'],
    content,
    data,
    'orders',
  );

  it('prunes only the devices Expo says are gone, matched by position', () => {
    const response = {
      data: [
        { status: 'ok', id: 't1' },
        { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', message: 'slow down', details: { error: 'MessageRateExceeded' } },
      ],
    };
    // A rate limit says nothing about the device; only DeviceNotRegistered does.
    expect(deadTokens(batch!, response)).toEqual(['ExponentPushToken[gone]']);
  });

  it('prunes nothing when the response is not what Expo sends', () => {
    for (const junk of [null, {}, { data: 'x' }, { errors: [{ code: 'INTERNAL' }] }]) {
      expect(deadTokens(batch!, junk)).toEqual([]);
    }
  });
});
