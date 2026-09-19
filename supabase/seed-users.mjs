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
  { key: 'riya', email: 'riya@campus.edu', name: 'Riya Sharma', role: 'student' },
  { key: 'arjun', email: 'arjun@campus.edu', name: 'Arjun Nair', role: 'student' },
  { key: 'meera', email: 'meera@campus.edu', name: 'Meera Iyer', role: 'student' },
  {
    key: 'mainStaff',
    email: 'main.canteen@campus.edu',
    name: 'Main Canteen',
    role: 'canteen',
    canteen: CANTEENS.main,
  },
  {
    key: 'hostelStaff',
    email: 'hostel.canteen@campus.edu',
    name: 'Hostel Canteen',
    role: 'canteen',
    canteen: CANTEENS.hostel,
  },
  {
    key: 'nightStaff',
    email: 'night.canteen@campus.edu',
    name: 'Night Canteen',
    role: 'canteen',
    canteen: CANTEENS.night,
  },
  {
    key: 'juiceStaff',
    email: 'juice.corner@campus.edu',
    name: 'Juice Corner',
    role: 'canteen',
    canteen: CANTEENS.juice,
  },
  {
    key: 'vikram',
    email: 'vikram@campus.edu',
    name: 'Vikram Singh',
    role: 'delivery',
    approved: true,
  },
  {
    key: 'imran',
    email: 'imran@campus.edu',
    name: 'Imran Qureshi',
    role: 'delivery',
    approved: true,
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
    const where = person.canteen ? ` @ ${CANTEEN_NAMES[person.canteen]}` : '';
    console.log(`  ${person.email.padEnd(26)} ${person.role}${where}`);
  }

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
  for (const to of ['accepted', 'preparing', 'ready']) {
    await rpc(mainStaff, 'transition_order', { p_order_id: done, p_to: to });
  }
  await rpc(vikram, 'claim_delivery', { p_order_id: done });
  await rpc(vikram, 'transition_order', { p_order_id: done, p_to: 'picked_up' });
  await rpc(vikram, 'transition_order', { p_order_id: done, p_to: 'delivered' });
  await api('/rest/v1/reviews', {
    token: riya,
    method: 'POST',
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
  for (const to of ['accepted', 'preparing', 'ready']) {
    await rpc(mainStaff, 'transition_order', { p_order_id: ready, p_to: to });
  }
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
  await rpc(hostelStaff, 'transition_order', { p_order_id: preparing, p_to: 'accepted' });
  await rpc(hostelStaff, 'transition_order', { p_order_id: preparing, p_to: 'preparing' });
  console.log('  preparing');

  // 4. Brand new, so the canteen app has something to accept or reject.
  await place(riya, {
    canteen: CANTEENS.juice,
    items: [{ item_id: shake, quantity: 2 }],
    key: 'demo-pending',
  });
  console.log('  pending, waiting for the canteen');

  console.log(`\nDone. Every account's password is "${PASSWORD}".`);
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
