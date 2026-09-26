#!/usr/bin/env node
/**
 * Proves the stack against a real Supabase, with the anon key and real sign-ins.
 *
 * This is deliberately NOT what `seed-users.mjs` does. That script uses the service role
 * key, which bypasses RLS entirely -- a clean run there proves PostgREST and the RPCs
 * exist, and nothing about whether the authorization model works. Everything here goes
 * through `anon` + a real GoTrue session, so a policy that is missing or wrong fails.
 *
 * Covers, in order:
 *   1. Auth        -- every seeded role can actually sign in
 *   2. Realtime    -- a canteen device is woken by an order it did not place
 *   3. End to end  -- student -> canteen -> partner -> delivered, each step as that person
 *   4. RLS         -- the boundaries, including the privilege escalation rule 8 closes
 *
 * Usage (after `npm run db:seed:users`):
 *
 *   node --env-file=.env scripts/verify-live.mjs
 *
 * Needs SUPABASE_URL and SUPABASE_ANON_KEY. The service role key is never read here,
 * on purpose: if this file could bypass RLS it could not test it.
 */
import { createClient } from '@supabase/supabase-js';

const URL_BASE = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PASSWORD = process.env.SEED_PASSWORD ?? 'campus1234';

if (!URL_BASE || !ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY. See .env.example.');
  process.exit(1);
}
// A legacy key carries `service_role` in its JWT payload. A newer `sb_secret_...` key
// is opaque and says nothing about itself, so the prefix is the only tell -- and this
// check is the whole reason the file can claim to test RLS rather than bypass it.
if (/service_role/.test(ANON_KEY) || ANON_KEY.startsWith('sb_secret_')) {
  console.error('That looks like a service role key. This script must run as anon.');
  process.exit(1);
}

const REALTIME_TIMEOUT_MS = 15_000;
/**
 * SUBSCRIBED means the channel joined, not that the postgres_changes filter is live:
 * Realtime registers that with the replication worker a moment later. An INSERT landing
 * in the gap is simply never delivered, which looked exactly like a broken publication
 * the first time this ran. Measured against this project -- the event arrives reliably
 * with a settle pause and is missed without one.
 */
const REALTIME_SETTLE_MS = 4_000;

let failures = 0;
let checks = 0;
/** Set once the canteen's real hours are known, so they are always put back. */
let restoreHours = null;
/** Set once the menu section has created a dish, so the campus never keeps it. */
let removeTestDish = null;
/** Favourites can be deleted by their owner, so this one always is. */
let removeTestFavorite = null;

function ok(label) {
  checks += 1;
  console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
  checks += 1;
  failures += 1;
  console.error(`  ✗ ${label}`);
  if (detail) console.error(`      ${detail}`);
}

function check(label, condition, detail) {
  if (condition) ok(label);
  else fail(label, detail);
}

function section(title) {
  console.log(`\n${title}`);
}

/** A fresh client per person: sessions must not leak between roles. */
async function signIn(email) {
  const client = createClient(URL_BASE, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

async function main() {
  console.log(`Verifying ${URL_BASE}\n`);

  // -------------------------------------------------------------------------
  section('1. Auth');
  // -------------------------------------------------------------------------
  const people = {};
  for (const [key, email] of Object.entries({
    riya: 'riya@campus.edu',
    arjun: 'arjun@campus.edu',
    mainCanteen: 'main.canteen@campus.edu',
    juiceCorner: 'juice.corner@campus.edu',
    vikram: 'vikram@campus.edu',
    admin: 'admin@campus.edu',
  })) {
    try {
      people[key] = await signIn(email);
      ok(`${email} signs in`);
    } catch (error) {
      fail(`${email} signs in`, error.message);
    }
  }
  if (failures) {
    console.error('\nCannot continue without sessions. Has `npm run db:seed:users` run?');
    return;
  }

  // getIdentity's own query: role comes from the database, never from a JWT claim.
  const { data: riyaProfile } = await people.riya.client
    .from('profiles')
    .select('role')
    .eq('id', people.riya.userId)
    .single();
  check('a student reads their own role from the database', riyaProfile?.role === 'student');

  // -------------------------------------------------------------------------
  section('2. Realtime');
  // -------------------------------------------------------------------------
  // Subscribe BEFORE the order exists, as the canteen would. The payload is ignored by
  // design (realtime.ts) -- what matters is that the device is woken at all.
  const { data: staffRow } = await people.mainCanteen.client
    .from('canteen_staff')
    .select('canteen_id')
    .maybeSingle();
  const canteenId = staffRow?.canteen_id;
  check('the canteen account resolves its own canteen', Boolean(canteenId));
  if (!canteenId) return;

  let realtimeEvent = null;
  const channel = people.mainCanteen.client
    .channel('verify-orders')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders', filter: `canteen_id=eq.${canteenId}` },
      (payload) => {
        realtimeEvent = payload;
      },
    );

  const subscribed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), REALTIME_TIMEOUT_MS);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve(true);
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        resolve(false);
      }
    });
  });
  check('a canteen subscribes to its own orders channel', subscribed);
  if (subscribed) await new Promise((resolve) => setTimeout(resolve, REALTIME_SETTLE_MS));

  // -------------------------------------------------------------------------
  section('3. End to end');
  // -------------------------------------------------------------------------
  // place_order refuses a closed canteen, and the seeded hours are real: Main Canteen
  // shuts at 22:00 IST, so this script would only work during the day. Opening the
  // canteen is not a workaround bolted on -- it is the canteen doing the one thing its
  // column grant allows, so this doubles as a live test of that grant.
  const { data: hours } = await people.mainCanteen.client
    .from('canteens')
    .select('opens_at, closes_at')
    .eq('id', canteenId)
    .single();
  const { error: openError } = await people.mainCanteen.client
    .from('canteens')
    .update({ opens_at: '00:00', closes_at: '00:00' })
    .eq('id', canteenId);
  check('a canteen may set its own hours', !openError, openError?.message);
  restoreHours = async () => {
    if (!hours) return;
    await people.mainCanteen.client
      .from('canteens')
      .update({ opens_at: hours.opens_at, closes_at: hours.closes_at })
      .eq('id', canteenId);
  };

  const { data: menu } = await people.riya.client
    .from('menu_items')
    .select('id, price_paise')
    .eq('canteen_id', canteenId)
    .eq('is_active', true)
    .order('price_paise', { ascending: false })
    .limit(2);
  check('a student reads the menu', (menu?.length ?? 0) > 0);
  if (!menu?.length) return;

  const { data: hostels } = await people.riya.client.from('hostels').select('id, blocks').limit(1);
  const hostel = hostels?.[0];
  check('a student reads the hostel list', Boolean(hostel));
  if (!hostel) return;

  const idempotencyKey = `verify-${Date.now()}`;
  const { data: orderId, error: placeError } = await people.riya.client.rpc('place_order', {
    p_canteen_id: canteenId,
    p_items: menu.map((item) => ({ item_id: item.id, quantity: 2 })),
    p_hostel_id: hostel.id,
    p_block: hostel.blocks?.[0] ?? 'A',
    p_room: '214',
    p_idempotency_key: idempotencyKey,
    p_note: 'live verification',
    p_payment_method: 'cod',
  });
  check('the student places an order', Boolean(orderId), placeError?.message);
  if (!orderId) return;

  // Idempotency over real HTTP, not just in SQL: the same key must not make a second order.
  const { data: repeatId } = await people.riya.client.rpc('place_order', {
    p_canteen_id: canteenId,
    p_items: menu.map((item) => ({ item_id: item.id, quantity: 2 })),
    p_hostel_id: hostel.id,
    p_block: hostel.blocks?.[0] ?? 'A',
    p_room: '214',
    p_idempotency_key: idempotencyKey,
    p_note: 'live verification',
    p_payment_method: 'cod',
  });
  check('a repeated idempotency key returns the same order', repeatId === orderId);

  const move = async (person, to, label) => {
    const { error } = await people[person].client.rpc('transition_order', {
      p_order_id: orderId,
      p_to: to,
      p_reason: null,
    });
    check(label, !error, error?.message);
  };

  await move('mainCanteen', 'accepted', 'the canteen accepts it');
  await move('mainCanteen', 'preparing', 'the canteen starts preparing');
  await move('mainCanteen', 'ready', 'the canteen marks it ready');

  const { error: claimError } = await people.vikram.client.rpc('claim_delivery', {
    p_order_id: orderId,
  });
  check('the partner claims it', !claimError, claimError?.message);

  await move('vikram', 'picked_up', 'the partner picks it up');
  await move('vikram', 'delivered', 'the partner delivers it');

  const { data: finalOrder } = await people.riya.client
    .from('orders')
    .select('status, total_paise, platform_fee_paise')
    .eq('id', orderId)
    .single();
  check('the student sees it delivered', finalOrder?.status === 'delivered');
  check(
    'our cut was recorded and is less than the total',
    typeof finalOrder?.platform_fee_paise === 'number' &&
      finalOrder.platform_fee_paise > 0 &&
      finalOrder.platform_fee_paise < finalOrder.total_paise,
  );

  const { data: history } = await people.riya.client
    .from('order_status_history')
    .select('to_status, actor')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  check(
    'every move was written to the trail by the right actor',
    history?.some((h) => h.to_status === 'accepted' && h.actor === 'canteen') &&
      history?.some((h) => h.to_status === 'delivered' && h.actor === 'delivery'),
  );

  // Back to realtime: the event should have arrived while all that happened.
  if (subscribed) {
    const deadline = Date.now() + REALTIME_TIMEOUT_MS;
    while (!realtimeEvent && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    check('the canteen was woken by the new order over realtime', Boolean(realtimeEvent));
  }
  await people.mainCanteen.client.removeChannel(channel);

  // -------------------------------------------------------------------------
  section('4. RLS');
  // -------------------------------------------------------------------------
  // The other half of that grant: the row is theirs, the columns are not.
  const { error: renameError } = await people.mainCanteen.client
    .from('canteens')
    .update({ name: 'Hijacked Canteen' })
    .eq('id', canteenId);
  check('a canteen cannot rename itself', Boolean(renameError));

  const { error: selfDisableError } = await people.mainCanteen.client
    .from('canteens')
    .update({ is_active: false })
    .eq('id', canteenId);
  check('a canteen cannot disable itself', Boolean(selfDisableError));

  const { data: otherStudentView } = await people.arjun.client
    .from('orders')
    .select('id')
    .eq('id', orderId);
  check("another student cannot read someone else's order", (otherStudentView?.length ?? 0) === 0);

  const { data: otherCanteenView } = await people.juiceCorner.client
    .from('orders')
    .select('id')
    .eq('id', orderId);
  check("another canteen cannot read a rival's order", (otherCanteenView?.length ?? 0) === 0);

  // Rule 8, and the hole `harden_default_privileges` closes: with Supabase's default
  // grants this would succeed and make a student an admin.
  const { error: escalation } = await people.arjun.client
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', people.arjun.userId);
  check('a student cannot make themselves an admin', Boolean(escalation), 'the update succeeded');

  // Rule 3: no client holds a write grant on orders, admins included.
  const { error: directWrite } = await people.mainCanteen.client
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('id', orderId);
  check('no client can write orders.status directly', Boolean(directWrite), 'the update succeeded');

  const { error: wrongActor } = await people.arjun.client.rpc('transition_order', {
    p_order_id: orderId,
    p_to: 'cancelled',
    p_reason: null,
  });
  check('a stranger cannot move an order they are not party to', Boolean(wrongActor));

  const { data: adminOrders } = await people.admin.client.from('orders').select('id').limit(5);
  check('an admin reads across the platform', (adminOrders?.length ?? 0) > 0);

  const { data: adminRevenue } = await people.admin.client
    .from('revenue_by_canteen_day')
    .select('canteen_id, platform_fee_paise')
    .limit(5);
  check('the revenue view answers an admin', (adminRevenue?.length ?? 0) > 0);

  const { data: canteenRevenue } = await people.juiceCorner.client
    .from('revenue_by_canteen_day')
    .select('canteen_id');
  check(
    'the revenue view is scoped by security_invoker, not wide open',
    (canteenRevenue ?? []).every((row) => row.canteen_id !== canteenId),
  );

  // -------------------------------------------------------------------------
  section('5. Menu');
  // -------------------------------------------------------------------------
  // The counter's own screen writes `menu_items` directly rather than through an RPC,
  // which is only safe because `menu_items_own_canteen` carries the WITH CHECK. These
  // checks are that policy, exercised by the accounts it is written about -- the
  // PGlite suite can assert the policy exists, but only a real sign-in proves the
  // grant and the policy agree.
  const dishName = `Verify Dish ${Date.now()}`;
  const { data: dish, error: createDishError } = await people.mainCanteen.client
    .from('menu_items')
    .insert({ canteen_id: canteenId, name: dishName, price_paise: 4200 })
    .select('id, is_available, is_active')
    .maybeSingle();
  check('a canteen adds a dish to its own menu', Boolean(dish), createDishError?.message);

  if (dish) {
    removeTestDish = async () => {
      // Never ordered, so nothing references it and the FK does not object.
      await people.mainCanteen.client.from('menu_items').delete().eq('id', dish.id);
    };

    const { data: soldOut } = await people.mainCanteen.client
      .from('menu_items')
      .update({ is_available: false })
      .eq('id', dish.id)
      .select('is_available')
      .maybeSingle();
    check('a canteen marks its own dish sold out', soldOut?.is_available === false);

    // The student still sees it: `listMenu` returns unavailable items on purpose, so
    // someone looking for Maggi reads "sold out" rather than finding it missing.
    const { data: studentSees } = await people.riya.client
      .from('menu_items')
      .select('id, is_available')
      .eq('id', dish.id)
      .maybeSingle();
    check('a sold-out dish is still visible to a student', studentSees?.is_available === false);

    // A rival gets no error and no rows: RLS filters the update rather than refusing it.
    const { data: rivalTouched } = await people.juiceCorner.client
      .from('menu_items')
      .update({ price_paise: 1 })
      .eq('id', dish.id)
      .select('id');
    check("a rival canteen cannot price another canteen's dish", (rivalTouched ?? []).length === 0);

    // WITH CHECK, from the other direction: writing a row onto someone else's menu.
    const { error: rivalInsert } = await people.juiceCorner.client
      .from('menu_items')
      .insert({ canteen_id: canteenId, name: `Intruder ${Date.now()}`, price_paise: 100 });
    check("a rival canteen cannot add to another canteen's menu", Boolean(rivalInsert));

    const { data: retired } = await people.mainCanteen.client
      .from('menu_items')
      .update({ is_active: false })
      .eq('id', dish.id)
      .select('is_active')
      .maybeSingle();
    check('a canteen takes its own dish off the menu', retired?.is_active === false);

    // And then it is gone from the student's menu, which filters `is_active`.
    const { data: afterRetire } = await people.riya.client
      .from('menu_items')
      .select('id')
      .eq('id', dish.id)
      .eq('is_active', true);
    check('a retired dish leaves the student menu', (afterRetire ?? []).length === 0);
  }

  // -------------------------------------------------------------------------
  section('6. Order history');
  // -------------------------------------------------------------------------
  // What `listMyOrders` asks for, embed and all. The student's history screen is the
  // first thing to read orders with their items in one round trip, and a PostgREST
  // embed either resolves against the real foreign keys or it does not -- no offline
  // suite can answer that.
  const { data: myHistory, error: historyError } = await people.riya.client
    .from('orders')
    .select('id, code, status, total_paise, created_at, order_items(name_snapshot, quantity)')
    .order('created_at', { ascending: false })
    .limit(20);
  check(
    'a student reads their own order history',
    (myHistory?.length ?? 0) > 0,
    historyError?.message,
  );
  check(
    'the order just placed is in it',
    (myHistory ?? []).some((row) => row.id === orderId),
  );
  check(
    'every order in the history carries its own line items',
    (myHistory ?? []).every((row) => (row.order_items?.length ?? 0) > 0),
  );

  // The boundary the screen depends on: no student id appears in that query, because
  // `orders_read` is what limits it. If RLS were the thing that was wrong, this is
  // where a stranger's order would appear.
  const { data: arjunHistory } = await people.arjun.client
    .from('orders')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(20);
  check(
    "a student's history is their own and nobody else's",
    (arjunHistory ?? []).every((row) => row.id !== orderId),
  );

  // -------------------------------------------------------------------------
  section('7. Engagement');
  // -------------------------------------------------------------------------
  // Ratings, favourites, coupons and complaints are all plain table writes held up
  // by policy alone, so this is the section that decides whether that was a good
  // idea. `reviews_insert_own` is the strictest policy in the schema -- it checks in
  // SQL that the order is the writer's own, delivered, and from the canteen being
  // rated -- and it has never been exercised by a real sign-in until now.
  //
  // Note on cleanup: `reviews` and `support_tickets` grant no DELETE to anyone, on
  // purpose, so the rows this section writes stay. That is the same bargain the
  // script already makes by placing a real order every run; the ticket is at least
  // closed by the admin below, which is a check in its own right.
  const { error: reviewError } = await people.riya.client.from('reviews').insert({
    order_id: orderId,
    student_id: people.riya.userId,
    canteen_id: canteenId,
    food_rating: 5,
    delivery_rating: 4,
    comment: 'Left by npm run verify:live.',
  });
  check('a student rates the order they just received', !reviewError, reviewError?.message);

  const { error: secondReview } = await people.riya.client.from('reviews').insert({
    order_id: orderId,
    student_id: people.riya.userId,
    canteen_id: canteenId,
    food_rating: 1,
  });
  check('the same order cannot be rated twice', Boolean(secondReview));

  // The policy's real job: a delivered order is not a licence to rate *any* order.
  const { error: strangerReview } = await people.arjun.client.from('reviews').insert({
    order_id: orderId,
    student_id: people.arjun.userId,
    canteen_id: canteenId,
    food_rating: 1,
  });
  check("a student cannot rate someone else's order", Boolean(strangerReview));

  const dishToFavourite = menu[0].id;
  // Insert, not upsert: `favorites` has no UPDATE grant because it has nothing to
  // update, and PostgREST's upsert is `on conflict do update`, which asks for one.
  const { error: favError } = await people.riya.client
    .from('favorites')
    .insert({ student_id: people.riya.userId, menu_item_id: dishToFavourite });
  check('a student favourites a dish', !favError, favError?.message);
  removeTestFavorite = async () => {
    await people.riya.client
      .from('favorites')
      .delete()
      .eq('student_id', people.riya.userId)
      .eq('menu_item_id', dishToFavourite);
  };

  // The embed the home screen reads, `!inner` and all.
  const { data: favourites } = await people.riya.client
    .from('favorites')
    .select('*, menu_items!inner(id, name, canteen_id)')
    .eq('menu_items.is_active', true);
  check(
    'the favourite comes back with its dish attached',
    (favourites ?? []).some((row) => row.menu_items?.id === dishToFavourite),
  );

  const { data: strangerFavourites } = await people.arjun.client.from('favorites').select('*');
  check(
    "one student's favourites are invisible to another",
    (strangerFavourites ?? []).every((row) => row.student_id !== people.riya.userId),
  );

  // `coupons_read` hides inactive and out-of-window codes from a student, so what
  // comes back here is exactly what the checkout screen may offer.
  const { data: coupons, error: couponError } = await people.riya.client
    .from('coupons')
    .select('code, is_active, valid_until');
  check('a student reads the usable coupon list', (coupons?.length ?? 0) > 0, couponError?.message);
  check(
    'no inactive coupon is offered to a student',
    (coupons ?? []).every((row) => row.is_active),
  );

  const { data: ticket, error: ticketError } = await people.riya.client
    .from('support_tickets')
    .insert({
      student_id: people.riya.userId,
      order_id: orderId,
      subject: 'Raised by npm run verify:live',
      body: 'Filed and closed by the verification script.',
    })
    .select('id, status')
    .maybeSingle();
  check('a student files a complaint', Boolean(ticket), ticketError?.message);

  if (ticket) {
    const { data: adminSees } = await people.admin.client
      .from('support_tickets')
      .select('id')
      .eq('id', ticket.id);
    check('an admin sees it in the queue', (adminSees ?? []).length === 1);

    const { data: otherStudentSees } = await people.arjun.client
      .from('support_tickets')
      .select('id')
      .eq('id', ticket.id);
    check('another student cannot read it', (otherStudentSees ?? []).length === 0);

    // UPDATE is granted to `authenticated`, but `support_tickets_admin` is the only
    // UPDATE policy -- so a student's own ticket filters to zero rows rather than
    // erroring. Nobody marks their own complaint resolved.
    const { data: selfResolve } = await people.riya.client
      .from('support_tickets')
      .update({ status: 'resolved' })
      .eq('id', ticket.id)
      .select('id');
    check('a student cannot resolve their own complaint', (selfResolve ?? []).length === 0);

    const { data: resolved, error: resolveError } = await people.admin.client
      .from('support_tickets')
      .update({ status: 'closed', resolution: 'Closed by the verification script.' })
      .eq('id', ticket.id)
      .select('status, resolution')
      .maybeSingle();
    check('an admin resolves it', resolved?.status === 'closed', resolveError?.message);

    const { data: studentReads } = await people.riya.client
      .from('support_tickets')
      .select('resolution')
      .eq('id', ticket.id)
      .maybeSingle();
    check('the student reads what was done about it', Boolean(studentReads?.resolution));
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error(`\nUnhandled: ${error.message}`);
  })
  .finally(async () => {
    // Always hand the canteen back its real opening hours, even after a failure.
    if (restoreHours) {
      try {
        await restoreHours();
      } catch (error) {
        console.error(`Could not restore canteen hours: ${error.message}`);
      }
    }
    if (removeTestDish) {
      try {
        await removeTestDish();
      } catch (error) {
        console.error(`Could not remove the test dish: ${error.message}`);
      }
    }
    if (removeTestFavorite) {
      try {
        await removeTestFavorite();
      } catch (error) {
        console.error(`Could not remove the test favourite: ${error.message}`);
      }
    }
    console.log(`\n${checks - failures}/${checks} checks passed.`);
    process.exit(failures === 0 ? 0 : 1);
  });
