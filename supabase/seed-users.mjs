#!/usr/bin/env node
/**
 * Seeds demo accounts and a few demo orders against a running Supabase.
 *
 * Accounts go through the Auth API rather than INSERT INTO auth.users, because the
 * hand-written approach breaks whenever GoTrue changes its schema.
 *
 * The demo orders are placed by calling the real place_order / transition_order /
 * claim_delivery RPCs as the real users, so running this also proves the whole
 * chain works against actual Supabase — not just against the test harness.
 *
 *   supabase start
 *   npm run db:seed:users
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (see .env.example).
 * Never run this against production: the passwords are public.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !SERVICE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Run `supabase status` and export them, or copy .env.example to .env.',
  );
  process.exit(1);
}
if (/supabase\.co/.test(URL_BASE) && !process.env.ALLOW_REMOTE_SEED) {
  console.error('Refusing to seed a hosted project. Set ALLOW_REMOTE_SEED=1 if you meant it.');
  process.exit(1);
}

const PASSWORD = 'campus1234';

const CANTEENS = {
  main: 'c0000000-0000-4000-8000-000000000001',
  hostel: 'c0000000-0000-4000-8000-000000000002',
  night: 'c0000000-0000-4000-8000-000000000003',
  juice: 'c0000000-0000-4000-8000-000000000004',
};
const CANTEEN_NAMES = {
  [CANTEENS.main]: 'Main Canteen',
  [CANTEENS.hostel]: 'Hostel Canteen',
  [CANTEENS.night]: 'Night Canteen',
  [CANTEENS.juice]: 'Juice Corner',
};

const HOSTELS = {
  aryabhatta: 'a0000000-0000-4000-8000-000000000001',
  ramanujan: 'a0000000-0000-4000-8000-000000000002',
};

const PEOPLE = [
  {
    key: 'riya',
    email: 'riya@campus.edu',
    name: 'Riya Sharma',
    role: 'student',
    home: { hostel: HOSTELS.aryabhatta, block: 'A', room: '214' },
  },
  {
    key: 'arjun',
    email: 'arjun@campus.edu',
    name: 'Arjun Nair',
    role: 'student',
    home: { hostel: HOSTELS.aryabhatta, block: 'B', room: '112' },
  },
  {
    key: 'meera',
    email: 'meera@campus.edu',
    name: 'Meera Iyer',
    role: 'student',
    home: { hostel: HOSTELS.ramanujan, block: 'A', room: '045' },
  },
  {
    key: 'mainStaff',
    email: 'main.canteen@campus.edu',
    name: 'Main Canteen Counter',
    role: 'canteen',
    canteen: CANTEENS.main,
  },
  {
    key: 'hostelStaff',
    email: 'hostel.canteen@campus.edu',
    name: 'Hostel Canteen Counter',
    role: 'canteen',
    canteen: CANTEENS.hostel,
  },
  {
    key: 'nightStaff',
    email: 'night.canteen@campus.edu',
    name: 'Night Canteen Counter',
    role: 'canteen',
    canteen: CANTEENS.night,
  },
  {
    key: 'juiceStaff',
    email: 'juice.corner@campus.edu',
    name: 'Juice Corner Counter',
    role: 'canteen',
    canteen: CANTEENS.juice,
  },
  {
    key: 'vikram',
    email: 'vikram@campus.edu',
    name: 'Vikram Singh',
    role: 'delivery',
    approved: true,
    // Delivery is canteen-scoped (ADR 008): a partner belongs to one canteen, and
    // delivery_partners.canteen_id is NOT NULL. Both sit at Main Canteen, matching
    // seedCampus in the test harness so the demo campus and the fixtures agree.
    canteen: CANTEENS.main,
  },
  {
    key: 'imran',
    email: 'imran@campus.edu',
    name: 'Imran Qureshi',
    role: 'delivery',
    approved: true,
    // Delivery is canteen-scoped (ADR 008): a partner belongs to one canteen, and
    // delivery_partners.canteen_id is NOT NULL. Both sit at Main Canteen, matching
    // seedCampus in the test harness so the demo campus and the fixtures agree.
    canteen: CANTEENS.main,
  },
  { key: 'admin', email: 'admin@campus.edu', name: 'Platform Admin', role: 'admin' },
];

async function api(path, { token = SERVICE_KEY, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  return data;
}

/** Create the account, or find it if a previous run already did. */
async function ensureUser({ email, name }) {
  try {
    const created = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: { email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } },
    });
    return created.id;
  } catch (err) {
    if (!/already|422|exists/i.test(String(err))) throw err;
    const found = await api(`/auth/v1/admin/users?filter=${encodeURIComponent(email)}`);
    const user = (found.users ?? []).find((u) => u.email === email);
    if (!user) throw new Error(`could not create or find ${email}`);
    return user.id;
  }
}

async function signIn(email) {
  const res = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  return res.access_token;
}

const rpc = (token, fn, args) => api(`/rest/v1/rpc/${fn}`, { token, method: 'POST', body: args });

async function itemId(canteenId, name) {
  const rows = await api(
    `/rest/v1/menu_items?canteen_id=eq.${canteenId}&name=eq.${encodeURIComponent(name)}&select=id`,
  );
  if (!rows[0]) throw new Error(`menu item "${name}" not found — run the SQL seed first`);
  return rows[0].id;
}

async function main() {
  console.log('Creating accounts…');
  const ids = {};
  for (const person of PEOPLE) {
    ids[person.key] = await ensureUser(person);
    // The signup trigger created the profile; set the role server-side.
    await api(`/rest/v1/profiles?id=eq.${ids[person.key]}`, {
      method: 'PATCH',
      body: { role: person.role, full_name: person.name },
    });
    if (person.role === 'canteen') {
      await api('/rest/v1/canteen_staff', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates' },
        body: { canteen_id: person.canteen, profile_id: ids[person.key] },
      });
    }
    if (person.role === 'delivery') {
      await api('/rest/v1/delivery_partners', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: {
          profile_id: ids[person.key],
          canteen_id: person.canteen,
          is_approved: true,
          is_active: true,
          is_online: true,
        },
      });
    }
    // A student's saved delivery address, as "Remember this address" at checkout writes
    // it. All-or-nothing by constraint, and it is only a default -- each order still
    // snapshots where it actually went.
    if (person.role === 'student' && person.home) {
      await api(`/rest/v1/profiles?id=eq.${ids[person.key]}`, {
        method: 'PATCH',
        body: {
          default_hostel_id: person.home.hostel,
          default_block: person.home.block,
          default_room: person.home.room,
        },
      });
    }

    const where = person.canteen ? ` @ ${CANTEEN_NAMES[person.canteen]}` : '';
    console.log(`  ${person.email.padEnd(26)} ${person.role}${where}`);
  }

  // place_order refuses a closed canteen, and the seeded hours are real ones -- Main
  // Canteen shuts at 22:00 IST. A seeder that only works during the day is a seeder that
  // fails at night, the same reason seedCampus forces 24 hours in the test harness. Open
  // them for the duration, then put the real hours back.
  const savedHours = await api('/rest/v1/canteens?select=id,opens_at,closes_at');
  const setHours = async (rows) => {
    for (const row of rows) {
      await api(`/rest/v1/canteens?id=eq.${row.id}`, {
        method: 'PATCH',
        body: { opens_at: row.opens_at, closes_at: row.closes_at },
      });
    }
  };
  await setHours(savedHours.map((row) => ({ ...row, opens_at: '00:00', closes_at: '00:00' })));

  try {
    await placeDemoOrders(ids);
  } finally {
    // Restore even if a demo order failed, so the project is never left permanently open.
    await setHours(savedHours);
  }

  console.log(`\nDone. Every account's password is "${PASSWORD}".`);
}

/** `ids` maps each seeded person key to their profile id, built in main(). */
async function placeDemoOrders(ids) {
  console.log('\nPlacing demo orders through the real RPCs…');
  const maggi = await itemId(CANTEENS.main, 'Masala Maggi');
  const coffee = await itemId(CANTEENS.main, 'Cold Coffee');
  const thali = await itemId(CANTEENS.main, 'Veg Thali');
  const paratha = await itemId(CANTEENS.hostel, 'Aloo Paratha');
  const shake = await itemId(CANTEENS.juice, 'Mango Shake');

  const riya = await signIn('riya@campus.edu');
  const arjun = await signIn('arjun@campus.edu');
  const meera = await signIn('meera@campus.edu');
  const mainStaff = await signIn('main.canteen@campus.edu');
  const hostelStaff = await signIn('hostel.canteen@campus.edu');
  const vikram = await signIn('vikram@campus.edu');

  /**
   * Walk an order along a path, skipping anything it has already done.
   *
   * `place_order` is idempotent, so a second run gets the *same* order back -- already
   * delivered. Replaying the transitions then failed with "INVALID_TRANSITION: delivered
   * -> accepted", which made this script a one-shot despite CLAUDE.md telling people to
   * re-run it. Finding where the order already sits on its own path fixes that, and also
   * repairs a run that died halfway.
   *
   * `claim_delivery` is not a transition_order call, so it is named in the path and
   * dispatched separately.
   */
  const drive = async (orderId, path) => {
    const [order] = await api(`/rest/v1/orders?id=eq.${orderId}&select=status`);
    const reached = path.findIndex((step) => step.status === order.status);
    for (const step of path.slice(reached + 1)) {
      if (step.claim) await rpc(step.token, 'claim_delivery', { p_order_id: orderId });
      else await rpc(step.token, 'transition_order', { p_order_id: orderId, p_to: step.status });
    }
  };

  const place = (token, args) =>
    rpc(token, 'place_order', {
      p_canteen_id: args.canteen,
      p_items: args.items,
      p_hostel_id: args.hostel ?? HOSTELS.aryabhatta,
      p_block: args.block ?? 'A',
      p_room: args.room ?? '214',
      p_idempotency_key: args.key,
      p_note: args.note ?? '',
      p_coupon_code: args.coupon ?? null,
      p_payment_method: 'cod',
    });

  // 1. Delivered, and reviewed — gives the student a reorder target and the
  //    canteen a completed sale.
  const done = await place(riya, {
    canteen: CANTEENS.main,
    items: [
      { item_id: maggi, quantity: 2 },
      { item_id: coffee, quantity: 1 },
    ],
    key: 'demo-delivered',
    note: 'Less spicy please',
  });
  await drive(done, [
    { status: 'pending' },
    { status: 'accepted', token: mainStaff },
    { status: 'preparing', token: mainStaff },
    { status: 'ready', token: mainStaff },
    { status: 'assigned', token: vikram, claim: true },
    { status: 'picked_up', token: vikram },
    { status: 'delivered', token: vikram },
  ]);
  // One review per order (reviews_order_id_key). `resolution=ignore-duplicates` only
  // applies when the conflict target is named, so a re-run needs `on_conflict` too.
  await api('/rest/v1/reviews?on_conflict=order_id', {
    token: riya,
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: {
      order_id: done,
      student_id: ids.riya,
      canteen_id: CANTEENS.main,
      food_rating: 5,
      delivery_rating: 4,
      comment: 'Maggi still hot when it reached the room.',
    },
  });
  console.log('  delivered + reviewed');

  // 2. Sitting in the delivery pool, so the partner app has something to claim.
  const ready = await place(arjun, {
    canteen: CANTEENS.main,
    items: [{ item_id: thali, quantity: 1 }],
    key: 'demo-ready',
    block: 'B',
    room: '112',
  });
  await drive(ready, [
    { status: 'pending' },
    { status: 'accepted', token: mainStaff },
    { status: 'preparing', token: mainStaff },
    { status: 'ready', token: mainStaff },
  ]);
  console.log('  ready, waiting in the pool');

  // 3. Mid-preparation, so the student app has a live tracker.
  const preparing = await place(meera, {
    canteen: CANTEENS.hostel,
    items: [{ item_id: paratha, quantity: 2 }],
    key: 'demo-preparing',
    hostel: HOSTELS.ramanujan,
    block: 'A',
    room: '045',
  });
  await drive(preparing, [
    { status: 'pending' },
    { status: 'accepted', token: hostelStaff },
    { status: 'preparing', token: hostelStaff },
  ]);
  console.log('  preparing');

  // 4. Brand new, so the canteen app has something to accept or reject.
  await place(riya, {
    canteen: CANTEENS.juice,
    items: [{ item_id: shake, quantity: 2 }],
    key: 'demo-pending',
  });
  console.log('  pending, waiting for the canteen');
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
