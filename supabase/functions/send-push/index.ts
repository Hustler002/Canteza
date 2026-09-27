import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  notificationContext,
  orderNotification,
  PUSH_CHANNEL,
  type NotificationAudience,
} from '../_shared/notifications.generated.ts';
import {
  deadTokens,
  EXPO_PUSH_URL,
  PUSH_SECRET_HEADER,
  pushBatches,
  readWebhookRecord,
} from '../_shared/push.ts';
import { timingSafeEqual } from '../_shared/razorpay.ts';

/**
 * Sends a `notifications` row to the recipient's phones.
 *
 * Fired by a Supabase Database Webhook on INSERT into `notifications`, configured in the
 * dashboard rather than a migration because it carries this project's URL and a secret.
 * `notify_order` already decided who hears about what when it wrote the row; this only
 * delivers it. The wording comes from `orderNotification()` -- a generated copy of the
 * function the inbox calls -- so the lock screen and the inbox cannot disagree.
 *
 * Authentication is a shared secret in a header, checked in constant time, not a JWT:
 * the webhook is the only intended caller, and a secret the dashboard sends is simpler
 * and narrower than handing the webhook a service role key.
 *
 * A push failing is never an error the database sees. The row is already written and the
 * inbox already shows it; push is best effort, and every failure here is logged and
 * answered 200 except a bad secret.
 */

const PUSH_WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Fail closed: with no secret configured, nobody is let in.
  if (!PUSH_WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('send-push is missing required environment variables');
    return json({ error: 'not configured' }, 500);
  }
  const presented = req.headers.get(PUSH_SECRET_HEADER) ?? '';
  if (!timingSafeEqual(presented, PUSH_WEBHOOK_SECRET)) {
    return json({ error: 'forbidden' }, 401);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'malformed body' }, 400);
  }

  const record = readWebhookRecord(payload);
  if (!record) return json({ ignored: true });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: tokens, error: tokenError }, { data: order }] = await Promise.all([
    admin.from('push_tokens').select('token').eq('user_id', record.user_id),
    admin
      .from('orders')
      .select('code, canteen_name_snapshot, hostel_label')
      .eq('id', record.order_id)
      .maybeSingle(),
  ]);
  if (tokenError) {
    console.error('send-push could not read tokens', tokenError.message);
    return json({ sent: 0, error: 'could not read tokens' });
  }
  if (!tokens?.length) return json({ sent: 0 }); // signed in on no device with push

  const content = orderNotification(
    record.audience as NotificationAudience,
    record.status!,
    notificationContext(order),
  );
  if (!content) return json({ sent: 0, ignored: 'no wording for this status' });

  const batches = pushBatches(
    tokens.map((row: { token: string }) => row.token),
    content,
    { notificationId: record.id, orderId: record.order_id!, audience: record.audience },
    PUSH_CHANNEL.id,
  );

  let sent = 0;
  const dead: string[] = [];
  for (const batch of batches) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        // Only needed if "enhanced push security" is switched on for the Expo project.
        ...(EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok) {
      console.error('Expo push refused a batch', response.status, await response.text());
      continue;
    }
    const tickets = await response.json();
    dead.push(...deadTokens(batch, tickets));
    sent += batch.length;
  }

  if (dead.length) {
    await admin.from('push_tokens').delete().in('token', dead);
  }

  return json({ sent, pruned: dead.length });
});
