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
 * `is_online` as a real shift toggle.
 *
 * The rule worth protecting is the asymmetry: going off shift hides new work, but
 * never strands food already in someone's hands. A partner who walks out of the
 * canteen and toggles off must still be able to complete the delivery they are
 * carrying, and the student must still see it move.
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

async function setOnline(profileId: string, online: boolean): Promise<void> {
  await db.asUser(profileId);
  await db.query(`update public.delivery_partners set is_online = $2 where profile_id = $1`, [
    profileId,
    online,
  ]);
}

/** A Main Canteen order sitting unclaimed in that canteen's ready queue. */
async function readyOrder(): Promise<string> {
  await db.asUser(campus.student);
  const id = await placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity: 2 }],
    key: `shift-${counter++}`,
  });
  await db.asUser(campus.staff);
  await move(id, 'accepted');
  await move(id, 'preparing');
  await move(id, 'ready');
  return id;
}

const visibleOrders = async (): Promise<string[]> => {
  const { rows } = await db.query<{ id: string }>(`select id from public.orders`);
  return rows.map((r) => r.id);
};

describe('going off shift', () => {
  it('hides the canteen’s ready queue', async () => {
    const id = await readyOrder();

    await setOnline(campus.partner, true);
    expect(await visibleOrders()).toContain(id);

    await setOnline(campus.partner, false);
    expect(await visibleOrders()).not.toContain(id);

    await setOnline(campus.partner, true);
  });

  it('refuses a claim, and says it is about the shift rather than permissions', async () => {
    const id = await readyOrder();
    await setOnline(campus.partner, false);

    await db.asUser(campus.partner);
    await expectError(() => db.query(`select public.claim_delivery($1::uuid)`, [id]), 'OFF_SHIFT');

    await setOnline(campus.partner, true);
  });

  it('still says FORBIDDEN to someone who is not a delivery partner at all', async () => {
    const id = await readyOrder();
    await db.asUser(campus.student);
    await expectError(() => db.query(`select public.claim_delivery($1::uuid)`, [id]), 'FORBIDDEN');
  });
});

describe('an order already in hand', () => {
  it('stays visible and completable after the partner goes off shift', async () => {
    const id = await readyOrder();
    await setOnline(campus.partner, true);

    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);

    // Walks out of the canteen, toggles off, then finishes the drop.
    await setOnline(campus.partner, false);

    await db.asUser(campus.partner);
    expect(await visibleOrders()).toContain(id);
    await move(id, 'picked_up');
    await move(id, 'delivered');

    await db.asOwner();
    const { rows } = await db.query<{ status: string }>(
      `select status from public.orders where id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('delivered');

    await setOnline(campus.partner, true);
  });

  it('can still be released back to the queue while off shift', async () => {
    const id = await readyOrder();
    await setOnline(campus.partner, true);
    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);

    await setOnline(campus.partner, false);
    await db.asUser(campus.partner);
    await db.query(`select public.release_delivery($1::uuid)`, [id]);

    await db.asOwner();
    const { rows } = await db.query<{ status: string; delivery_partner_id: string | null }>(
      `select status, delivery_partner_id from public.orders where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ status: 'ready', delivery_partner_id: null });

    await setOnline(campus.partner, true);
  });
});

describe('the toggle belongs to the partner', () => {
  it('cannot be flipped for someone else', async () => {
    await setOnline(campus.otherPartner, false);

    // Vikram tries to put Imran on shift.
    await db.asUser(campus.partner);
    await db.query(`update public.delivery_partners set is_online = true where profile_id = $1`, [
      campus.otherPartner,
    ]);

    await db.asOwner();
    const { rows } = await db.query<{ is_online: boolean }>(
      `select is_online from public.delivery_partners where profile_id = $1`,
      [campus.otherPartner],
    );
    expect(rows[0]!.is_online).toBe(false);
  });

  it('is cleared when a canteen retires the partner, and not restored on reinstatement', async () => {
    await setOnline(campus.otherPartner, true);

    await db.asUser(campus.staff);
    await db.query(`select public.canteen_set_partner_active($1::uuid, false)`, [
      campus.otherPartner,
    ]);
    await db.asOwner();
    let { rows } = await db.query<{ is_online: boolean }>(
      `select is_online from public.delivery_partners where profile_id = $1`,
      [campus.otherPartner],
    );
    expect(rows[0]!.is_online).toBe(false);

    await db.asUser(campus.staff);
    await db.query(`select public.canteen_set_partner_active($1::uuid, true)`, [
      campus.otherPartner,
    ]);
    await db.asOwner();
    ({ rows } = await db.query<{ is_online: boolean }>(
      `select is_online from public.delivery_partners where profile_id = $1`,
      [campus.otherPartner],
    ));
    // Coming back to work is the partner's own action, not the manager's.
    expect(rows[0]!.is_online).toBe(false);
  });
});

describe('several deliveries at once', () => {
  it('lets one partner carry more than one order', async () => {
    await setOnline(campus.partner, true);
    const first = await readyOrder();
    const second = await readyOrder();

    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [first]);
    await db.query(`select public.claim_delivery($1::uuid)`, [second]);

    await db.asOwner();
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.orders
        where delivery_partner_id = $1 and status = 'assigned'`,
      [campus.partner],
    );
    // Three bags to the same hostel is one trip, not three (ADR 008).
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2);
  });
});
