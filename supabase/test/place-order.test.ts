import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PLATFORM_DEFAULTS } from '../../packages/shared/src/config';
import {
  createTestDb,
  expectError,
  menuItem,
  placeOrder,
  seedCampus,
  type Campus,
  type Db,
} from './harness';

let db: Db;
let campus: Campus;
let maggi: string;
let coffee: string;
let juice: string;

beforeAll(async () => {
  db = await createTestDb();
  campus = await seedCampus(db);
  maggi = await menuItem(db, campus.mainCanteen, 'Masala Maggi'); // ₹40
  coffee = await menuItem(db, campus.mainCanteen, 'Cold Coffee'); // ₹60
  juice = await menuItem(db, campus.juiceCorner, 'Mango Shake'); // ₹60
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.asUser(campus.student);
});

const cart = (key: string, items = [{ item_id: maggi, quantity: 2 }]) =>
  placeOrder(db, { canteen: campus.mainCanteen, hostel: campus.hostel, items, key });

describe('place_order — totals', () => {
  it('computes money from database prices, not from anything the client sent', async () => {
    const id = await cart('t-totals', [
      { item_id: maggi, quantity: 2 },
      { item_id: coffee, quantity: 1 },
    ]);

    await db.asOwner();
    const { rows } = await db.query<Record<string, number | string>>(
      `select subtotal_paise, discount_paise, delivery_fee_paise, total_paise,
              platform_fee_paise, canteen_name_snapshot, hostel_label, block, room, status
         from public.orders where id = $1`,
      [id],
    );
    // 2 x ₹40 + 1 x ₹60 = ₹140, + ₹10 delivery = ₹150
    expect(rows[0]).toMatchObject({
      subtotal_paise: 14000,
      discount_paise: 0,
      delivery_fee_paise: PLATFORM_DEFAULTS.deliveryFeePaise,
      total_paise: 15000,
      platform_fee_paise: PLATFORM_DEFAULTS.platformFeePaise,
      canteen_name_snapshot: 'Main Canteen',
      hostel_label: 'Aryabhatta Hostel',
      block: 'A',
      room: '214',
      status: 'pending',
    });
  });

  it('snapshots item name and unit price so a later price rise cannot rewrite the receipt', async () => {
    const id = await cart('t-snapshot');

    await db.asOwner();
    await db.query(
      `update public.menu_items set price_paise = 9900, name = 'Renamed' where id = $1`,
      [maggi],
    );

    const { rows } = await db.query<{ name_snapshot: string; unit_price_paise: number }>(
      `select name_snapshot, unit_price_paise from public.order_items where order_id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ name_snapshot: 'Masala Maggi', unit_price_paise: 4000 });

    await db.query(
      `update public.menu_items set price_paise = 4000, name = 'Masala Maggi' where id = $1`,
      [maggi],
    );
  });

  it('creates the payment, the first history row and both notifications', async () => {
    const id = await cart('t-sideeffects');
    await db.asOwner();

    const payment = await db.query<{ method: string; status: string; amount_paise: number }>(
      `select method, status, amount_paise from public.payments where order_id = $1`,
      [id],
    );
    // Cash is collected at the door, so COD starts pending, never "paid".
    expect(payment.rows[0]).toMatchObject({ method: 'cod', status: 'pending', amount_paise: 9000 });

    const history = await db.query(
      `select from_status, to_status, actor from public.order_status_history where order_id = $1`,
      [id],
    );
    expect(history.rows).toEqual([{ from_status: null, to_status: 'pending', actor: 'student' }]);

    const notes = await db.query<{ audience: string }>(
      `select audience from public.notifications where order_id = $1 order by audience`,
      [id],
    );
    expect(notes.rows.map((r) => r.audience)).toEqual(['canteen', 'student']);
  });

  it('merges a duplicated item id instead of creating two lines', async () => {
    const id = await cart('t-dupe', [
      { item_id: maggi, quantity: 1 },
      { item_id: maggi, quantity: 2 },
    ]);
    await db.asOwner();
    const { rows } = await db.query<{ quantity: number }>(
      `select quantity from public.order_items where order_id = $1`,
      [id],
    );
    expect(rows).toEqual([{ quantity: 3 }]);
  });

  it('gives each order a human-readable code', async () => {
    const id = await cart('t-code');
    await db.asOwner();
    const { rows } = await db.query<{ code: string }>(
      `select code from public.orders where id = $1`,
      [id],
    );
    expect(rows[0]!.code).toMatch(/^#\d+$/);
  });
});

describe('place_order — idempotency', () => {
  it('returns the same order when the key repeats', async () => {
    const first = await cart('t-idem');
    const second = await cart('t-idem');
    expect(second).toBe(first);

    await db.asOwner();
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.orders where idempotency_key = 't-idem'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('keys are scoped per student, so two students may reuse one key', async () => {
    const mine = await cart('t-shared-key');
    await db.asUser(campus.otherStudent);
    const theirs = await cart('t-shared-key');
    expect(theirs).not.toBe(mine);
  });

  it('refuses an empty idempotency key rather than silently allowing duplicates', async () => {
    await expectError(() => cart(''), 'DUPLICATE_REQUEST');
  });
});

describe('place_order — business rules', () => {
  it('refuses an empty cart', async () => {
    await expectError(() => cart('t-empty', []), 'CART_EMPTY');
  });

  it('refuses a canteen that has paused orders', async () => {
    await db.asOwner();
    await db.query(`update public.canteens set is_accepting_orders = false where id = $1`, [
      campus.mainCanteen,
    ]);
    await db.asUser(campus.student);
    await expectError(() => cart('t-paused'), 'CANTEEN_CLOSED');

    await db.asOwner();
    await db.query(`update public.canteens set is_accepting_orders = true where id = $1`, [
      campus.mainCanteen,
    ]);
  });

  it('refuses a canteen outside its opening hours', async () => {
    await db.asOwner();
    // A one-minute window that is almost certainly not now.
    await db.query(
      `update public.canteens set opens_at = '03:00', closes_at = '03:01' where id = $1`,
      [campus.mainCanteen],
    );
    await db.asUser(campus.student);
    await expectError(() => cart('t-closed'), 'CANTEEN_CLOSED');

    await db.asOwner();
    await db.query(
      `update public.canteens set opens_at = '00:00', closes_at = '00:00' where id = $1`,
      [campus.mainCanteen],
    );
  });

  it('refuses an item that just went unavailable', async () => {
    await db.asOwner();
    await db.query(`update public.menu_items set is_available = false where id = $1`, [coffee]);
    await db.asUser(campus.student);
    await expectError(
      () => cart('t-unavailable', [{ item_id: coffee, quantity: 1 }]),
      'ITEM_UNAVAILABLE',
    );

    await db.asOwner();
    await db.query(`update public.menu_items set is_available = true where id = $1`, [coffee]);
  });

  it('refuses a cart that mixes canteens', async () => {
    await expectError(
      () =>
        cart('t-mixed', [
          { item_id: maggi, quantity: 1 },
          { item_id: juice, quantity: 1 },
        ]),
      'CART_MIXED_CANTEENS',
    );
  });

  it('refuses an order below the canteen minimum', async () => {
    const tea = await menuItem(db, campus.mainCanteen, 'Tea'); // ₹12, minimum is ₹50
    await db.asUser(campus.student);
    await expectError(() => cart('t-min', [{ item_id: tea, quantity: 1 }]), 'BELOW_MINIMUM_ORDER');
  });

  it('refuses nonsense quantities', async () => {
    await expectError(() => cart('t-qty0', [{ item_id: maggi, quantity: 0 }]), 'INVALID_QUANTITY');
    await expectError(
      () => cart('t-qty999', [{ item_id: maggi, quantity: 999 }]),
      'INVALID_QUANTITY',
    );
  });

  it('refuses a block that does not exist in the hostel', async () => {
    await expectError(
      () =>
        placeOrder(db, {
          canteen: campus.mainCanteen,
          hostel: campus.hostel,
          items: [{ item_id: maggi, quantity: 1 }],
          key: 't-block',
          block: 'Z',
        }),
      'NOT_FOUND',
    );
  });

  it('refuses a blank room number', async () => {
    await expectError(
      () =>
        placeOrder(db, {
          canteen: campus.mainCanteen,
          hostel: campus.hostel,
          items: [{ item_id: maggi, quantity: 1 }],
          key: 't-room',
          room: '   ',
        }),
      'NOT_FOUND',
    );
  });

  it('refuses a caller who is not a student', async () => {
    await db.asUser(campus.staff);
    await expectError(() => cart('t-staff-order'), 'FORBIDDEN');
    await db.asUser(campus.partner);
    await expectError(() => cart('t-partner-order'), 'FORBIDDEN');
  });

  it('refuses an anonymous caller', async () => {
    await db.exec(`reset role; set request.jwt.claim.sub = ''; set role authenticated;`);
    await expectError(() => cart('t-anon'), 'UNAUTHENTICATED');
  });
});

describe('place_order — coupons', () => {
  it('caps a percent coupon at its maximum discount', async () => {
    // ₹140 subtotal, FIRST50 is 50% capped at ₹50.
    const id = await cart('t-coupon-cap', [
      { item_id: maggi, quantity: 2 },
      { item_id: coffee, quantity: 1 },
    ]);
    await db.asOwner();
    await db.query(`delete from public.orders where id = $1`, [id]);

    await db.asUser(campus.student);
    const withCoupon = await placeOrder(db, {
      canteen: campus.mainCanteen,
      hostel: campus.hostel,
      items: [
        { item_id: maggi, quantity: 2 },
        { item_id: coffee, quantity: 1 },
      ],
      key: 't-coupon-applied',
      coupon: 'FIRST50',
    });

    await db.asOwner();
    const { rows } = await db.query<{ discount_paise: number; total_paise: number }>(
      `select discount_paise, total_paise from public.orders where id = $1`,
      [withCoupon],
    );
    expect(rows[0]).toMatchObject({ discount_paise: 5000, total_paise: 14000 - 5000 + 1000 });
  });

  it('records the redemption and enforces the per-student limit', async () => {
    await db.asOwner();
    const used = await db.query<{ n: number }>(
      `select count(*)::int as n from public.coupon_redemptions where student_id = $1`,
      [campus.student],
    );
    expect(used.rows[0]!.n).toBe(1);

    await db.asUser(campus.student);
    await expectError(
      () =>
        placeOrder(db, {
          canteen: campus.mainCanteen,
          hostel: campus.hostel,
          items: [
            { item_id: maggi, quantity: 2 },
            { item_id: coffee, quantity: 1 },
          ],
          key: 't-coupon-twice',
          coupon: 'FIRST50',
        }),
      'COUPON_INVALID',
    );
  });

  it('refuses a coupon below its minimum order', async () => {
    await expectError(
      () =>
        placeOrder(db, {
          canteen: campus.mainCanteen,
          hostel: campus.hostel,
          items: [{ item_id: maggi, quantity: 2 }], // ₹80, FLAT20 needs ₹150
          key: 't-coupon-min',
          coupon: 'FLAT20',
        }),
      'COUPON_INVALID',
    );
  });

  it('refuses an unknown coupon', async () => {
    await expectError(
      () =>
        placeOrder(db, {
          canteen: campus.mainCanteen,
          hostel: campus.hostel,
          items: [{ item_id: maggi, quantity: 2 }],
          key: 't-coupon-unknown',
          coupon: 'NOPE',
        }),
      'COUPON_INVALID',
    );
  });
});
