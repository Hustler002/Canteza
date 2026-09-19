import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, menuItem, placeOrder, seedCampus, type Campus, type Db } from './harness';

/**
 * `revenue_by_canteen_day`.
 *
 * Two things are worth pinning. The arithmetic — our cut is the platform fee and
 * nothing else, and the discount is reported rather than quietly absorbed into someone's
 * revenue. And the scoping: the view is `security_invoker`, so `orders_read` decides
 * what a caller sees. Without that a canteen account reading this view would have been
 * handed the whole platform's takings.
 */

let db: Db;
let campus: Campus;
let maggi: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
  campus = await seedCampus(db);
  maggi = await menuItem(db, campus.mainCanteen, 'Masala Maggi');
});
afterAll(async () => {
  await db?.close();
});

const move = (id: string, to: string) =>
  db.query(`select public.transition_order($1::uuid, $2, null)`, [id, to]);

/** Place an order at Main Canteen and carry it all the way to delivered. */
async function deliveredOrder(quantity: number, coupon?: string): Promise<string> {
  await db.asUser(campus.student);
  const id = await placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity }],
    key: `rev-${counter++}`,
    ...(coupon ? { coupon } : {}),
  });
  await db.asUser(campus.staff);
  await move(id, 'accepted');
  await move(id, 'preparing');
  await move(id, 'ready');
  await move(id, 'delivered');
  return id;
}

type Row = {
  orders: number;
  gross_subtotal_paise: number;
  discounts_paise: number;
  platform_fee_paise: number;
  canteen_received_paise: number;
  students_paid_paise: number;
};

const mainRow = async (): Promise<Row | undefined> => {
  const { rows } = await db.query<Row>(
    `select orders, gross_subtotal_paise, discounts_paise, platform_fee_paise,
            canteen_received_paise, students_paid_paise
       from public.revenue_by_canteen_day where canteen_id = $1`,
    [campus.mainCanteen],
  );
  return rows[0];
};

describe('the arithmetic', () => {
  it('counts only delivered orders', async () => {
    await db.asUser(campus.student);
    const abandoned = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      // Two, not one: Main Canteen's minimum order is Rs 50 and a single Maggi is Rs 40.
      items: [{ item_id: maggi, quantity: 2 }],
      key: `rev-cancel-${counter++}`,
    });
    await move(abandoned, 'cancelled');

    await db.asOwner();
    const { rows } = await db.query(`select * from public.revenue_by_canteen_day`);
    // A cancelled order consumes nothing, so it is not a row here either.
    expect(rows).toHaveLength(0);
  });

  it('splits one order into our cut and the canteen’s', async () => {
    await deliveredOrder(2);

    await db.asOwner();
    const row = (await mainRow())!;
    expect(row.orders).toBe(1);
    // ₹2 of the ₹10 delivery fee is ours, and nothing on the food (ADR 008).
    expect(row.platform_fee_paise).toBe(200);
    expect(row.canteen_received_paise).toBe(row.students_paid_paise - 200);
  });

  it('reports a discount rather than hiding it inside a revenue figure', async () => {
    const { rows: coupons } = await db.query<{ code: string }>(
      `select code from public.coupons where is_active limit 1`,
    );
    const code = coupons[0]!.code;

    await deliveredOrder(4, code);

    await db.asOwner();
    const row = (await mainRow())!;
    expect(row.orders).toBe(2);
    expect(row.discounts_paise).toBeGreaterThan(0);

    // Gross is what the food listed at; the students paid less by exactly the discount
    // plus the delivery fees. The discount never disappears into a "revenue" column.
    const { rows: raw } = await db.query<{ n: number }>(
      `select sum(subtotal_paise - discount_paise + delivery_fee_paise + packaging_fee_paise)::int as n
         from public.orders where status = 'delivered' and canteen_id = $1`,
      [campus.mainCanteen],
    );
    expect(row.students_paid_paise).toBe(raw[0]!.n);
    expect(row.canteen_received_paise).toBe(row.students_paid_paise - row.platform_fee_paise);
  });

  it('groups on the campus day, not the server’s', async () => {
    // An order placed at 00:30 IST belongs to that day, not to the UTC day before it.
    await db.asOwner();
    const { rows } = await db.query<{ day: string; created: string }>(
      `select day::text, (select min(created_at) from public.orders)::text as created
         from public.revenue_by_canteen_day limit 1`,
    );
    const { rows: expected } = await db.query<{ day: string }>(
      `select ((select min(created_at) from public.orders) at time zone 'Asia/Kolkata')::date::text as day`,
    );
    expect(rows[0]!.day).toBe(expected[0]!.day);
  });
});

describe('who can see what', () => {
  it('shows an admin the whole platform', async () => {
    await db.asUser(campus.admin);
    const { rows } = await db.query(`select canteen_id from public.revenue_by_canteen_day`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('shows a canteen only its own takings', async () => {
    // The point of security_invoker. Juice Corner has delivered nothing, so it sees
    // nothing — not Main Canteen's money.
    await db.asUser(campus.otherStaff);
    const { rows } = await db.query(`select canteen_id from public.revenue_by_canteen_day`);
    expect(rows).toEqual([]);

    await db.asUser(campus.staff);
    const mine = await db.query<{ canteen_id: string }>(
      `select canteen_id from public.revenue_by_canteen_day`,
    );
    expect(mine.rows.every((r) => r.canteen_id === campus.mainCanteen)).toBe(true);
    expect(mine.rows.length).toBeGreaterThan(0);
  });

  it('does not leak another student’s spending to a student', async () => {
    await db.asUser(campus.otherStudent);
    const { rows } = await db.query(`select canteen_id from public.revenue_by_canteen_day`);
    expect(rows).toEqual([]);
  });
});
