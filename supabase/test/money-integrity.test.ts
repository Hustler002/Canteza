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
 * Regressions for two bugs found auditing Phase 2. Both cost somebody real money.
 */

let db: Db;
let campus: Campus;
let maggi: string;
let coffee: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
  campus = await seedCampus(db);
  maggi = await menuItem(db, campus.mainCanteen, 'Masala Maggi'); // ₹40
  coffee = await menuItem(db, campus.mainCanteen, 'Cold Coffee'); // ₹60
});
afterAll(async () => {
  await db?.close();
});

const move = (id: string, to: string, reason?: string) =>
  db.query(`select public.transition_order($1::uuid, $2, $3)`, [id, to, reason ?? null]);

/** ₹140 of food — enough for FIRST50, which needs ₹100. */
const couponCart = (key: string, coupon?: string) =>
  placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [
      { item_id: maggi, quantity: 2 },
      { item_id: coffee, quantity: 1 },
    ],
    key,
    ...(coupon ? { coupon } : {}),
  });

describe('a coupon is not spent by an order that never happened', () => {
  it('gives the code back when the canteen rejects the order', async () => {
    await db.asUser(campus.student);
    const id = await couponCart(`c${counter++}`, 'FIRST50');

    await db.asUser(campus.staff);
    await move(id, 'rejected', 'out of gas');

    // The redemption is released...
    await db.asOwner();
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.coupon_redemptions where order_id = $1`,
      [id],
    );
    expect(rows[0]!.n).toBe(0);

    // ...and the student can actually use it again, which is the point.
    await db.asUser(campus.student);
    const retry = await couponCart(`c${counter++}`, 'FIRST50');
    const applied = await db.query<{ discount_paise: number }>(
      `select discount_paise from public.orders where id = $1`,
      [retry],
    );
    expect(applied.rows[0]!.discount_paise).toBe(5000);
  });

  it('gives the code back when the student cancels', async () => {
    await db.asUser(campus.otherStudent);
    const id = await couponCart(`c${counter++}`, 'FIRST50');
    await move(id, 'cancelled', 'changed my mind');

    await db.asOwner();
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.coupon_redemptions where order_id = $1`,
      [id],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('still records which code was applied, for the order history', async () => {
    await db.asUser(campus.otherStudent);
    const id = await couponCart(`c${counter++}`, 'FIRST50');
    await move(id, 'cancelled');

    await db.asOwner();
    const { rows } = await db.query<{ coupon_code_snapshot: string; discount_paise: number }>(
      `select coupon_code_snapshot, discount_paise from public.orders where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ coupon_code_snapshot: 'FIRST50', discount_paise: 5000 });
  });

  it('keeps a delivered order’s redemption, so the limit still bites', async () => {
    await db.asUser(campus.student);
    const id = await couponCart(`c${counter++}`);
    await db.asUser(campus.staff);
    await move(id, 'accepted');
    await move(id, 'preparing');
    await move(id, 'ready');
    await move(id, 'delivered');

    // Riya's earlier successful redemption is still on the books.
    await db.asOwner();
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.coupon_redemptions where student_id = $1`,
      [campus.student],
    );
    expect(rows[0]!.n).toBe(1);

    await db.asUser(campus.student);
    await expectError(() => couponCart(`c${counter++}`, 'FIRST50'), 'COUPON_INVALID');
  });
});

describe('a kitchen never cooks an order that has not been paid for', () => {
  it('refuses to accept a prepaid order while the payment is unverified', async () => {
    await db.asUser(campus.student);
    const id = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      items: [{ item_id: maggi, quantity: 2 }],
      key: `c${counter++}`,
      method: 'razorpay',
    });

    await db.asOwner();
    const payment = await db.query<{ status: string }>(
      `select status from public.payments where order_id = $1`,
      [id],
    );
    expect(payment.rows[0]!.status).toBe('initiated');

    await db.asUser(campus.staff);
    await expectError(() => move(id, 'accepted'), 'PAYMENT_UNVERIFIED');
  });

  it('accepts it once the payment is verified server-side', async () => {
    await db.asUser(campus.student);
    const id = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      items: [{ item_id: maggi, quantity: 2 }],
      key: `c${counter++}`,
      method: 'razorpay',
    });

    // Only the verify-payment Edge Function may do this; no client has the grant.
    await db.asOwner();
    await db.query(
      `update public.payments set status = 'success', paid_at = now() where order_id = $1`,
      [id],
    );

    await db.asUser(campus.staff);
    await move(id, 'accepted');
    await db.asOwner();
    const { rows } = await db.query<{ status: string }>(
      `select status from public.orders where id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('accepted');
  });

  it('never blocks a cash order, which is settled at the door', async () => {
    await db.asUser(campus.student);
    const id = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      items: [{ item_id: maggi, quantity: 2 }],
      key: `c${counter++}`,
    });
    await db.asUser(campus.staff);
    await move(id, 'accepted');
    await db.asOwner();
    const { rows } = await db.query<{ status: string }>(
      `select status from public.orders where id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('accepted');
  });

  it('lets an unpaid prepaid order still be rejected or cancelled', async () => {
    await db.asUser(campus.student);
    const id = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      items: [{ item_id: maggi, quantity: 2 }],
      key: `c${counter++}`,
      method: 'razorpay',
    });
    await db.asUser(campus.staff);
    await move(id, 'rejected', 'never paid');

    await db.asOwner();
    const { rows } = await db.query<{ status: string; failure_reason: string }>(
      `select status, failure_reason from public.payments where order_id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ status: 'failed', failure_reason: 'never paid' });
  });
});

describe('the platform fee', () => {
  it('is capped at the delivery fee it is taken from', async () => {
    await db.asOwner();
    await db.query(`update public.platform_settings set value = '9900' where key = $1`, [
      'platform_fee_paise',
    ]);

    await db.asUser(campus.student);
    const id = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      items: [{ item_id: maggi, quantity: 2 }],
      key: `c${counter++}`,
    });

    await db.asOwner();
    const { rows } = await db.query<{ platform_fee_paise: number; delivery_fee_paise: number }>(
      `select platform_fee_paise, delivery_fee_paise from public.orders where id = $1`,
      [id],
    );
    // A misconfigured setting must not invent revenue out of the canteen's share.
    expect(rows[0]!.platform_fee_paise).toBe(rows[0]!.delivery_fee_paise);

    await db.query(`update public.platform_settings set value = '200' where key = $1`, [
      'platform_fee_paise',
    ]);
  });

  it('leaves the canteen the whole food subtotal', async () => {
    await db.asUser(campus.student);
    const id = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      items: [
        { item_id: maggi, quantity: 2 },
        { item_id: coffee, quantity: 1 },
      ],
      key: `c${counter++}`,
    });

    await db.asOwner();
    const { rows } = await db.query<{
      subtotal_paise: number;
      delivery_fee_paise: number;
      platform_fee_paise: number;
      total_paise: number;
    }>(
      `select subtotal_paise, delivery_fee_paise, platform_fee_paise, total_paise
         from public.orders where id = $1`,
      [id],
    );
    const o = rows[0]!;
    const canteenTakes = o.subtotal_paise + (o.delivery_fee_paise - o.platform_fee_paise);
    expect(o.platform_fee_paise).toBe(200); // ₹2
    expect(canteenTakes).toBe(14000 + 800); // all the food, plus ₹8
    expect(canteenTakes + o.platform_fee_paise).toBe(o.total_paise);
  });
});
