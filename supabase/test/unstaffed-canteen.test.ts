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
 * A canteen nobody can run takes no orders (unstaffed_canteen_closed). Found live: two
 * canteens whose only counter accounts were banned kept taking orders, prepaid ones
 * included, that nobody could ever accept.
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

const order = async () => {
  await db.asUser(campus.student);
  return placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity: 2 }],
    key: `unstaffed-${++key}`,
  });
};

/** What a student reads for a canteen: the view is security_invoker, so as them. */
async function accepting(canteen: string): Promise<boolean | null> {
  await db.asUser(campus.student);
  const { rows } = await db.query<{ is_accepting_orders: boolean }>(
    `select is_accepting_orders from public.canteens_public where id = $1`,
    [canteen],
  );
  return rows[0]?.is_accepting_orders ?? null;
}

const setActive = async (id: string, active: boolean) => {
  await db.asUser(campus.admin);
  await db.query(`select public.admin_set_profile_active($1::uuid, $2)`, [id, active]);
};

describe('a canteen with someone at the counter', () => {
  it('takes orders, and a student can read that it does', async () => {
    expect(await accepting(campus.mainCanteen)).toBe(true);
    await order();
  });

  it('still answers to its own pause switch', async () => {
    await db.asOwner();
    await db.query(`update public.canteens set is_accepting_orders = false where id = $1`, [
      campus.mainCanteen,
    ]);
    expect(await accepting(campus.mainCanteen)).toBe(false);
    await db.asOwner();
    await db.query(`update public.canteens set is_accepting_orders = true where id = $1`, [
      campus.mainCanteen,
    ]);
    expect(await accepting(campus.mainCanteen)).toBe(true);
  });
});

describe('a canteen with nobody who can work it', () => {
  it('reads as not taking orders when it never had staff', async () => {
    expect(await accepting(campus.hostelCanteen)).toBe(false);
  });

  it('closes when an admin suspends its only worker, and reopens on restore', async () => {
    await setActive(campus.staff, false);
    expect(await accepting(campus.mainCanteen)).toBe(false);
    await expectError(() => order(), 'CANTEEN_CLOSED');

    await setActive(campus.staff, true);
    expect(await accepting(campus.mainCanteen)).toBe(true);
    await order();
  });

  it('closes when the worker is banned at Auth alone, as the live emergency bans were', async () => {
    await db.asOwner();
    await db.query(
      `update auth.users set banned_until = now() + interval '100 years' where id = $1`,
      [campus.staff],
    );
    expect(await accepting(campus.mainCanteen)).toBe(false);
    await expectError(() => order(), 'CANTEEN_CLOSED');

    await db.asOwner();
    await db.query(`update auth.users set banned_until = null where id = $1`, [campus.staff]);
    expect(await accepting(campus.mainCanteen)).toBe(true);
  });

  it('tells nobody anything but the boolean, and anon not even that', async () => {
    const { rows } = await db.query<Record<string, boolean>>(`
      select
        has_function_privilege('anon', 'public.canteen_is_staffed(uuid)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.canteen_is_staffed(uuid)', 'execute') as signed_in,
        has_function_privilege('authenticated', 'public.orders_refuse_unstaffed_canteen()', 'execute') as trigger_fn
    `);
    expect(rows[0]).toEqual({ anon: false, signed_in: true, trigger_fn: false });
  });
});
