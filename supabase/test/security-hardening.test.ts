import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDb,
  expectError,
  menuItem,
  placeOrder,
  seedCampus,
  type Campus,
  type Db,
} from './harness';

/**
 * The pre-launch hardening (the security_hardening migration). Each block here was a
 * live finding: the attack worked against the hosted project before the migration, and
 * each test is that attack, now refused.
 */

let db: Db;
let campus: Campus;
let maggi: string;
let key = 0;

beforeAll(async () => {
  db = await createTestDb();
  campus = await seedCampus(db);
  maggi = await menuItem(db, campus.mainCanteen, 'Masala Maggi');
});
afterAll(async () => {
  await db?.close();
});

const order = () =>
  placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity: 2 }],
    key: `hardening-${++key}`,
  });

const setActive = async (id: string, active: boolean) => {
  await db.asUser(campus.admin);
  await db.query(`select public.admin_set_profile_active($1::uuid, $2)`, [id, active]);
};

describe('a suspended canteen account', () => {
  it('loses its canteen, its orders and its menu the moment it is suspended', async () => {
    await db.asUser(campus.student);
    const id = await order();

    await db.asUser(campus.staff);
    const before = await db.query(`select id from public.orders where id = $1`, [id]);
    expect(before.rows).toHaveLength(1);

    await setActive(campus.staff, false);
    try {
      await db.asUser(campus.staff);
      const mine = await db.query<{ id: string | null }>(`select public.my_canteen_id() as id`);
      expect(mine.rows[0]!.id).toBeNull();

      const orders = await db.query(`select id from public.orders where id = $1`, [id]);
      expect(orders.rows).toHaveLength(0);

      const menu = await db.query(
        `update public.menu_items set price_paise = 1 where id = $1 returning id`,
        [maggi],
      );
      expect(menu.rows).toHaveLength(0);

      await expectError(
        () => db.query(`select public.transition_order($1::uuid, 'accepted')`, [id]),
        'FORBIDDEN',
      );
    } finally {
      await setActive(campus.staff, true);
    }

    await db.asUser(campus.staff);
    const mine = await db.query<{ id: string | null }>(`select public.my_canteen_id() as id`);
    expect(mine.rows[0]!.id).toBe(campus.mainCanteen);
  });
});

describe('suspension at Supabase Auth', () => {
  it('bans the account and ends its sessions; restoring lifts the ban', async () => {
    await db.asOwner();
    await db.query(`insert into auth.sessions (user_id) values ($1), ($1)`, [campus.otherStudent]);

    await setActive(campus.otherStudent, false);
    await db.asOwner();
    const banned = await db.query<{ banned: boolean; sessions: number }>(
      `select u.banned_until > now() + interval '50 years' as banned,
              (select count(*)::int from auth.sessions s where s.user_id = u.id) as sessions
         from auth.users u where u.id = $1`,
      [campus.otherStudent],
    );
    expect(banned.rows[0]).toEqual({ banned: true, sessions: 0 });

    await setActive(campus.otherStudent, true);
    await db.asOwner();
    const restored = await db.query<{ banned_until: string | null }>(
      `select banned_until from auth.users where id = $1`,
      [campus.otherStudent],
    );
    expect(restored.rows[0]!.banned_until).toBeNull();
  });

  it('refuses every order write from a suspended account, whatever the path', async () => {
    // Claimed and picked up by the partner, then the partner is suspended mid-delivery:
    // the order stays with the admin to finish, not with the account that was stopped.
    await db.asUser(campus.student);
    const id = await order();
    for (const [who, to] of [
      [campus.staff, 'accepted'],
      [campus.staff, 'preparing'],
      [campus.staff, 'ready'],
    ] as const) {
      await db.asUser(who);
      await db.query(`select public.transition_order($1::uuid, $2)`, [id, to]);
    }
    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);

    await setActive(campus.partner, false);
    try {
      await db.asUser(campus.partner);
      await expectError(
        () => db.query(`select public.transition_order($1::uuid, 'picked_up')`, [id]),
        'ACCOUNT_SUSPENDED',
      );
    } finally {
      await setActive(campus.partner, true);
    }

    // The server's own work carries no user and is never refused by this guard.
    await db.asOwner();
    await db.query(`update public.orders set status = 'picked_up' where id = $1`, [id]);
  });
});

describe('support tickets', () => {
  it('refuses a ticket that arrives already resolved', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(
        `insert into public.support_tickets (student_id, subject, status, resolution)
         values ($1, 'x', 'resolved', 'Refund approved')`,
        [campus.student],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses a ticket pinned to another student's order", async () => {
    await db.asUser(campus.otherStudent);
    const theirs = await order();

    await db.asUser(campus.student);
    await expect(
      db.query(
        `insert into public.support_tickets (student_id, order_id, subject) values ($1, $2, 'x')`,
        [campus.student, theirs],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('takes a complaint about your own order, open and unanswered', async () => {
    await db.asUser(campus.student);
    const mine = await order();
    const { rows } = await db.query<{ status: string; resolution: string | null }>(
      `insert into public.support_tickets (student_id, order_id, subject, body)
       values ($1, $2, 'Cold food', 'It arrived cold') returning status, resolution`,
      [campus.student, mine],
    );
    expect(rows[0]).toEqual({ status: 'open', resolution: null });
  });

  it('lets an admin answer a ticket but not rewrite what the student said', async () => {
    await db.asUser(campus.admin);
    const answered = await db.query(
      `update public.support_tickets set status = 'resolved', resolution = 'Refunded'
        where subject = 'Cold food' returning id`,
    );
    expect(answered.rows).toHaveLength(1);
    await expect(
      db.query(`update public.support_tickets set subject = 'edited' where subject = 'Cold food'`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('reviews', () => {
  it('leaves id and created_at to the database', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(
        `insert into public.reviews (order_id, student_id, canteen_id, food_rating, created_at)
         values (gen_random_uuid(), $1, $2, 5, '2020-01-01')`,
        [campus.student, campus.mainCanteen],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('lengths and links', () => {
  it('refuses a name longer than the form allows', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(`update public.profiles set full_name = $2 where id = $1`, [
        campus.student,
        'x'.repeat(81),
      ]),
    ).rejects.toThrow(/profiles_full_name_len/);
  });

  it('refuses a picture link that is not https', async () => {
    await db.asUser(campus.student);
    for (const url of [
      'javascript:alert(1)',
      'http://example.com/a.png',
      'data:image/png;base64,AA',
    ]) {
      await expect(
        db.query(`update public.profiles set avatar_url = $2 where id = $1`, [campus.student, url]),
      ).rejects.toThrow(/profiles_avatar_url_https/);
    }
    await db.query(`update public.profiles set avatar_url = $2 where id = $1`, [
      campus.student,
      'https://images.example.com/me.png',
    ]);
  });

  it('refuses a delivery note longer than the form allows', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(
        `select public.place_order($1::uuid, $2::jsonb, $3::uuid, 'A', '214', 'long-note', $4)`,
        [
          campus.mainCanteen,
          JSON.stringify([{ item_id: maggi, quantity: 2 }]),
          campus.hostel,
          'x'.repeat(301),
        ],
      ),
    ).rejects.toThrow(/orders_delivery_note_len/);
  });
});

describe('open orders per student', () => {
  it('stops at the ceiling, and lets the next one through once an order finishes', async () => {
    await db.asOwner();
    // The harness raises the ceiling for every other suite; this one tests the default.
    await db.query(
      `delete from public.platform_settings where key = 'max_open_orders_per_student'`,
    );
    await db.query(`update public.orders set status = 'delivered' where student_id = $1`, [
      campus.otherStudent,
    ]);

    await db.asUser(campus.otherStudent);
    const open: string[] = [];
    for (let i = 0; i < 5; i += 1) open.push(await order());
    await expectError(() => order(), 'TOO_MANY_OPEN_ORDERS');

    // A retry of an order already placed is an answer, not a new order.
    const again = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      items: [{ item_id: maggi, quantity: 2 }],
      key: `hardening-${key - 1}`,
    });
    expect(open).toContain(again);

    await db.query(`select public.transition_order($1::uuid, 'cancelled', 'changed my mind')`, [
      open[0],
    ]);
    open.push(await order());
  });

  it('forgets orders a canteen never answered after twelve hours', async () => {
    await expectError(() => order(), 'TOO_MANY_OPEN_ORDERS');

    await db.asOwner();
    await db.query(
      `update public.orders set created_at = now() - interval '13 hours'
        where student_id = $1 and status = 'pending'`,
      [campus.otherStudent],
    );

    await db.asUser(campus.otherStudent);
    await order();
  });
});

describe('advisor findings', () => {
  it('keeps the helpers and the signup trigger off the anonymous API', async () => {
    await db.asOwner();
    const { rows } = await db.query<{ fn: string; anon: boolean; authenticated: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('auth_role', 'is_admin', 'my_canteen_id', 'my_delivery_canteen_id',
                            'is_delivery_partner', 'setting_int', 'handle_new_user')
        order by 1`,
    );
    for (const row of rows) {
      expect(row.anon, row.fn).toBe(false);
      expect(row.authenticated, row.fn).toBe(row.fn !== 'handle_new_user');
    }
    expect(rows).toHaveLength(7);
  });

  it('still creates a profile on signup with the trigger function locked down', async () => {
    const id = await db.createUser('new.student@campus.edu');
    await db.asOwner();
    const { rows } = await db.query(`select role from public.profiles where id = $1`, [id]);
    expect(rows).toEqual([{ role: 'student' }]);
  });

  it('runs canteens_public as the caller', async () => {
    await db.asOwner();
    const { rows } = await db.query<{ opts: string[] }>(
      `select reloptions as opts from pg_class where oid = 'public.canteens_public'::regclass`,
    );
    expect(rows[0]!.opts).toContain('security_invoker=true');

    await db.asUser(campus.student);
    const visible = await db.query(`select id from public.canteens_public`);
    expect(visible.rows.length).toBeGreaterThan(0);
  });
});
