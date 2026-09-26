import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, menuItem, placeOrder, seedCampus, type Campus, type Db } from './harness';

/**
 * `canteen_stats` — the rating and kitchen-speed figures behind the canteen cards.
 *
 * Two things are worth pinning, and they pull in opposite directions.
 *
 * The arithmetic: a median rather than a mean, measured from `accepted` to `ready`
 * and nothing either side of it, so neither the queue before a counter notices an
 * order nor the walk afterwards is blamed on the kitchen.
 *
 * And the scoping, which is the opposite call to `revenue_by_canteen_day`. That view
 * is `security_invoker` so RLS narrows it. This one deliberately is not: a student
 * must see the same campus-wide average and median as everyone else, and an invoker
 * view would have computed each of them a private figure from their own orders.
 * The test that matters is therefore that a *student* sees numbers built from other
 * people's orders — which for any other view in this schema would be a leak.
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

/**
 * Cook one order, with the accepted -> ready gap forced to `prepMinutes`.
 *
 * The history rows are written by `transition_order` with `now()`, so a test cannot
 * wait real minutes for a median. Back-dating the `accepted` row is the only way to
 * give the view something to measure, and it is the same row the view reads.
 */
async function cookedOrder(prepMinutes: number): Promise<string> {
  await db.asUser(campus.student);
  const id = await placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    // Two, not one: Main Canteen's seeded minimum order is ₹50 and a Maggi is ₹40,
    // so a single one is refused with BELOW_MINIMUM_ORDER before it can be cooked.
    items: [{ item_id: maggi, quantity: 2 }],
    key: `stats-${counter++}`,
  });

  await db.asUser(campus.staff);
  await move(id, 'accepted');

  // As owner: `order_status_history` is an append-only trail with no client UPDATE
  // grant at all, which is exactly right and means only a fixture can rewrite it.
  await db.asOwner();
  await db.query(
    `update public.order_status_history
        set created_at = created_at - ($2 || ' minutes')::interval
      where order_id = $1::uuid and to_status = 'accepted'`,
    [id, String(prepMinutes)],
  );

  await db.asUser(campus.staff);
  await move(id, 'preparing');
  await move(id, 'ready');
  return id;
}

async function statsFor(canteenId: string) {
  const { rows } = await db.query<{
    avg_food_rating: string | null;
    review_count: number;
    median_prep_minutes: number | null;
    prep_sample_size: number;
  }>(`select * from public.canteen_stats where canteen_id = $1::uuid`, [canteenId]);
  return rows[0];
}

describe('canteen_stats', () => {
  it('reports no rating and no timing for a canteen nothing has happened at', async () => {
    await db.asUser(campus.student);
    const row = await statsFor(campus.hostelCanteen);

    expect(row).toBeDefined();
    expect(row?.avg_food_rating).toBeNull();
    expect(row?.review_count).toBe(0);
    expect(row?.median_prep_minutes).toBeNull();
    expect(row?.prep_sample_size).toBe(0);
  });

  it('measures the kitchen from accepted to ready, as a median', async () => {
    // 10, 20 and 60 minutes. The mean is 30; the median is 20. The 60 stands in for
    // the order nobody marked ready until they were closing up.
    await cookedOrder(10);
    await cookedOrder(20);
    await cookedOrder(60);

    await db.asUser(campus.student);
    const row = await statsFor(campus.mainCanteen);

    expect(row?.prep_sample_size).toBe(3);
    expect(row?.median_prep_minutes).toBe(20);
  });

  it('averages the food rating and counts the reviews behind it', async () => {
    const first = await cookedOrder(15);
    const second = await cookedOrder(15);
    await db.asUser(campus.staff);
    await move(first, 'delivered');
    await move(second, 'delivered');

    await db.asUser(campus.student);
    for (const [orderId, rating] of [
      [first, 5],
      [second, 4],
    ] as const) {
      await db.query(
        `insert into public.reviews (order_id, student_id, canteen_id, food_rating)
         values ($1::uuid, $2::uuid, $3::uuid, $4)`,
        [orderId, campus.student, campus.mainCanteen, String(rating)],
      );
    }

    const row = await statsFor(campus.mainCanteen);
    expect(Number(row?.avg_food_rating)).toBeCloseTo(4.5, 1);
    expect(row?.review_count).toBe(2);
  });

  it('shows a student the campus-wide figures, not their own slice', async () => {
    // The point of the view not being security_invoker. Every order above was placed
    // by `campus.student`, so a second student with no history at all must still see
    // the same non-null numbers rather than an empty row.
    await db.asOwner();
    const otherId = await db.createUser('nobody@campus.edu', 'student', 'Nobody Ordered');

    await db.asUser(otherId);
    const row = await statsFor(campus.mainCanteen);

    expect(row?.median_prep_minutes).not.toBeNull();
    expect(row?.prep_sample_size).toBeGreaterThan(0);
    expect(row?.review_count).toBeGreaterThan(0);
  });

  it('exposes only aggregates, so running as owner discloses nothing per-order', async () => {
    const { rows: columns } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'canteen_stats'`,
    );
    const names = columns.map((c) => c.column_name).sort();

    // If this fails someone added a column. Check it is an aggregate before widening
    // the list — the view runs with the owner's rights, so a per-order or per-student
    // column here would bypass RLS for every caller.
    expect(names).toEqual([
      'avg_food_rating',
      'canteen_id',
      'median_prep_minutes',
      'prep_sample_size',
      'review_count',
    ]);
  });
});
