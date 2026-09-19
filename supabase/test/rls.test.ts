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
 * These are the tests that matter. Hiding a screen is not security; what stops one
 * student reading another student's order is the policy exercised here.
 */

let db: Db;
let campus: Campus;
let maggi: string;
let riyasOrder: string;
let arjunsOrder: string;
let juiceOrder: string;

const denied = /permission denied/i;

beforeAll(async () => {
  db = await createTestDb();
  campus = await seedCampus(db);
  maggi = await menuItem(db, campus.mainCanteen, 'Masala Maggi');
  const shake = await menuItem(db, campus.juiceCorner, 'Mango Shake');

  await db.asUser(campus.student);
  riyasOrder = await placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity: 2 }],
    key: 'rls-riya',
    room: '214',
  });

  await db.asUser(campus.otherStudent);
  arjunsOrder = await placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity: 2 }],
    key: 'rls-arjun',
    room: '007',
  });
  juiceOrder = await placeOrder(db, {
    canteen: campus.juiceCorner,
    hostel: campus.hostel,
    items: [{ item_id: shake, quantity: 1 }],
    key: 'rls-juice',
  });
});
afterAll(async () => {
  await db?.close();
});

const visibleOrders = async (): Promise<string[]> => {
  const { rows } = await db.query<{ id: string }>(`select id from public.orders`);
  return rows.map((r) => r.id);
};

describe('students', () => {
  it('sees only their own orders', async () => {
    await db.asUser(campus.student);
    expect(await visibleOrders()).toEqual([riyasOrder]);

    await db.asUser(campus.otherStudent);
    expect((await visibleOrders()).sort()).toEqual([arjunsOrder, juiceOrder].sort());
  });

  it('cannot reach another student’s order even by asking for it directly', async () => {
    await db.asUser(campus.student);
    const { rows } = await db.query(`select * from public.orders where id = $1`, [arjunsOrder]);
    expect(rows).toEqual([]);
  });

  it('cannot see the items or payment of an order it cannot see', async () => {
    await db.asUser(campus.student);
    const items = await db.query(`select * from public.order_items where order_id = $1`, [
      arjunsOrder,
    ]);
    const payment = await db.query(`select * from public.payments where order_id = $1`, [
      arjunsOrder,
    ]);
    expect(items.rows).toEqual([]);
    expect(payment.rows).toEqual([]);
  });

  it('cannot write orders at all — there is no grant to abuse', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(`update public.orders set status = 'delivered' where id = $1`, [riyasOrder]),
    ).rejects.toThrow(denied);
    await expect(
      db.query(
        `insert into public.orders (student_id, canteen_id, canteen_name_snapshot, hostel_label,
                                    block, room, subtotal_paise, total_paise, idempotency_key)
         values ($1, $2, 'x', 'y', 'A', '1', 0, 0, 'hack')`,
        [campus.student, campus.mainCanteen],
      ),
    ).rejects.toThrow(denied);
  });

  it('cannot promote itself to admin', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(`update public.profiles set role = 'admin' where id = $1`, [campus.student]),
    ).rejects.toThrow(denied);
    await expectError(
      () => db.query(`select public.admin_set_role($1::uuid, 'admin')`, [campus.student]),
      'FORBIDDEN',
    );
  });

  it('can still edit its own name and phone', async () => {
    await db.asUser(campus.student);
    await db.query(`update public.profiles set full_name = 'Riya S.' where id = $1`, [
      campus.student,
    ]);
    const { rows } = await db.query<{ full_name: string }>(
      `select full_name from public.profiles where id = $1`,
      [campus.student],
    );
    expect(rows[0]!.full_name).toBe('Riya S.');
  });

  it('cannot edit another student’s profile', async () => {
    await db.asUser(campus.student);
    await db.query(`update public.profiles set full_name = 'hacked' where id = $1`, [
      campus.otherStudent,
    ]);
    await db.asOwner();
    const { rows } = await db.query<{ full_name: string }>(
      `select full_name from public.profiles where id = $1`,
      [campus.otherStudent],
    );
    expect(rows[0]!.full_name).not.toBe('hacked');
  });

  it('cannot read the delivery pool', async () => {
    await db.asUser(campus.student);
    const { rows } = await db.query(`select * from public.delivery_pool`);
    expect(rows).toEqual([]);
  });

  it('cannot see another student’s notifications', async () => {
    await db.asUser(campus.student);
    const { rows } = await db.query<{ user_id: string }>(
      `select user_id from public.notifications`,
    );
    expect(rows.every((r) => r.user_id === campus.student)).toBe(true);
  });
});

describe('canteens', () => {
  it('sees orders for its own canteen and no others', async () => {
    await db.asUser(campus.staff);
    expect((await visibleOrders()).sort()).toEqual([riyasOrder, arjunsOrder].sort());

    await db.asUser(campus.otherStaff);
    expect(await visibleOrders()).toEqual([juiceOrder]);
  });

  it('manages its own menu', async () => {
    await db.asUser(campus.staff);
    await db.query(`update public.menu_items set is_available = false where id = $1`, [maggi]);
    const { rows } = await db.query<{ is_available: boolean }>(
      `select is_available from public.menu_items where id = $1`,
      [maggi],
    );
    expect(rows[0]!.is_available).toBe(false);
    await db.query(`update public.menu_items set is_available = true where id = $1`, [maggi]);
  });

  it('cannot touch another canteen’s menu', async () => {
    await db.asUser(campus.otherStaff);
    await db.query(`update public.menu_items set price_paise = 1 where id = $1`, [maggi]);

    await db.asOwner();
    const { rows } = await db.query<{ price_paise: number }>(
      `select price_paise from public.menu_items where id = $1`,
      [maggi],
    );
    expect(rows[0]!.price_paise).toBe(4000);
  });

  it('cannot add an item to another canteen', async () => {
    await db.asUser(campus.otherStaff);
    await expect(
      db.query(
        `insert into public.menu_items (canteen_id, name, price_paise) values ($1, 'Sneaky', 100)`,
        [campus.mainCanteen],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('delivery partners', () => {
  it('cannot read orders it does not hold', async () => {
    await db.asUser(campus.partner);
    expect(await visibleOrders()).toEqual([]);
  });

  it('sees the pool without the student’s room number', async () => {
    await db.asOwner();
    await db.query(`update public.orders set status = 'ready' where id = $1`, [riyasOrder]);

    await db.asUser(campus.partner);
    const { rows, fields } = await db.query<Record<string, unknown>>(
      `select * from public.delivery_pool`,
    );
    expect(rows).toHaveLength(1);
    const columns = fields.map((f) => f.name);
    expect(columns).toContain('hostel_label');
    expect(columns).toContain('partner_payout_paise');
    // The room is what a partner does not need until they have taken the job.
    expect(columns).not.toContain('room');
    expect(columns).not.toContain('student_id');
  });

  it('sees the full address only once it holds the order', async () => {
    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [riyasOrder]);

    const { rows } = await db.query<{ room: string }>(
      `select room from public.orders where id = $1`,
      [riyasOrder],
    );
    expect(rows[0]!.room).toBe('214');

    // Still nothing about the other student's order.
    const others = await db.query(`select * from public.orders where id = $1`, [arjunsOrder]);
    expect(others.rows).toEqual([]);
  });

  it('cannot approve itself', async () => {
    await db.asUser(campus.partner);
    await expect(
      db.query(`update public.delivery_partners set is_approved = true where profile_id = $1`, [
        campus.partner,
      ]),
    ).rejects.toThrow(denied);
    await expectError(
      () => db.query(`select public.admin_set_partner_approval($1::uuid, true)`, [campus.partner]),
      'FORBIDDEN',
    );
  });

  it('can still toggle its own online status', async () => {
    await db.asUser(campus.partner);
    await db.query(`update public.delivery_partners set is_online = false where profile_id = $1`, [
      campus.partner,
    ]);
    const { rows } = await db.query<{ is_online: boolean }>(
      `select is_online from public.delivery_partners where profile_id = $1`,
      [campus.partner],
    );
    expect(rows[0]!.is_online).toBe(false);
  });
});

describe('admins', () => {
  it('sees every order', async () => {
    await db.asUser(campus.admin);
    expect((await visibleOrders()).sort()).toEqual([riyasOrder, arjunsOrder, juiceOrder].sort());
  });

  it('can change a role, through the audited function only', async () => {
    await db.asUser(campus.admin);
    await expect(
      db.query(`update public.profiles set role = 'admin' where id = $1`, [campus.otherStudent]),
    ).rejects.toThrow(denied);

    await db.query(`select public.admin_set_role($1::uuid, 'delivery')`, [campus.otherStudent]);
    await db.asOwner();
    const { rows } = await db.query<{ role: string }>(
      `select role from public.profiles where id = $1`,
      [campus.otherStudent],
    );
    expect(rows[0]!.role).toBe('delivery');
    await db.query(`update public.profiles set role = 'student' where id = $1`, [
      campus.otherStudent,
    ]);
  });
});

describe('reviews', () => {
  it('only the owner of a delivered order may review it', async () => {
    await db.asOwner();
    await db.query(`update public.orders set status = 'delivered' where id = $1`, [arjunsOrder]);

    // Not your order.
    await db.asUser(campus.student);
    await expect(
      db.query(
        `insert into public.reviews (order_id, student_id, canteen_id, food_rating)
         values ($1, $2, $3, 5)`,
        [arjunsOrder, campus.student, campus.mainCanteen],
      ),
    ).rejects.toThrow(/row-level security/i);

    // Your order, delivered: allowed.
    await db.asUser(campus.otherStudent);
    await db.query(
      `insert into public.reviews (order_id, student_id, canteen_id, food_rating, comment)
       values ($1, $2, $3, 4, 'Maggi was hot, delivery quick.')`,
      [arjunsOrder, campus.otherStudent, campus.mainCanteen],
    );

    await db.asOwner();
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.reviews where order_id = $1`,
      [arjunsOrder],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('refuses a review for an order that is not delivered', async () => {
    await db.asUser(campus.otherStudent);
    await expect(
      db.query(
        `insert into public.reviews (order_id, student_id, canteen_id, food_rating)
         values ($1, $2, $3, 5)`,
        [juiceOrder, campus.otherStudent, campus.juiceCorner],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
