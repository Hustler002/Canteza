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

/** A fresh pending order owned by campus.student. */
async function newOrder(): Promise<string> {
  await db.asUser(campus.student);
  return placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity: 2 }],
    key: `txn-${counter++}`,
  });
}

const move = (id: string, to: string, reason?: string) =>
  db.query(`select public.transition_order($1::uuid, $2, $3) as status`, [id, to, reason ?? null]);

const statusOf = async (id: string) => {
  const role = await db.query(`select current_user as u`);
  await db.asOwner();
  const { rows } = await db.query<{ status: string }>(
    `select status from public.orders where id = $1`,
    [id],
  );
  void role;
  return rows[0]!.status;
};

describe('the happy path', () => {
  it('runs pending -> delivered with each actor doing only their own step', async () => {
    const id = await newOrder();

    await db.asUser(campus.staff);
    await move(id, 'accepted');
    await move(id, 'preparing');
    await move(id, 'ready');
    expect(await statusOf(id)).toBe('ready');

    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);
    expect(await statusOf(id)).toBe('assigned');

    await db.asUser(campus.partner);
    await move(id, 'picked_up');
    await move(id, 'delivered');
    expect(await statusOf(id)).toBe('delivered');

    await db.asOwner();
    const history = await db.query<{ to_status: string; actor: string }>(
      `select to_status, actor from public.order_status_history
        where order_id = $1 order by id`,
      [id],
    );
    expect(history.rows).toEqual([
      { to_status: 'pending', actor: 'student' },
      { to_status: 'accepted', actor: 'canteen' },
      { to_status: 'preparing', actor: 'canteen' },
      { to_status: 'ready', actor: 'canteen' },
      { to_status: 'assigned', actor: 'delivery' },
      { to_status: 'picked_up', actor: 'delivery' },
      { to_status: 'delivered', actor: 'delivery' },
    ]);
  });

  it('settles the cash payment when the partner marks it delivered', async () => {
    const id = await newOrder();
    await db.asUser(campus.staff);
    await move(id, 'accepted');
    await move(id, 'preparing');
    await move(id, 'ready');
    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);
    await move(id, 'picked_up');
    await move(id, 'delivered');

    await db.asOwner();
    const { rows } = await db.query<{ status: string; paid_at: string | null }>(
      `select status, paid_at from public.payments where order_id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('success');
    expect(rows[0]!.paid_at).not.toBeNull();
  });
});

describe('who may do what', () => {
  it('stops a canteen skipping straight to delivered', async () => {
    const id = await newOrder();
    await db.asUser(campus.staff);
    await expectError(() => move(id, 'delivered'), 'INVALID_TRANSITION');
  });

  it('stops a student accepting their own order', async () => {
    const id = await newOrder();
    await db.asUser(campus.student);
    await expectError(() => move(id, 'accepted'), 'INVALID_TRANSITION');
  });

  it('stops another canteen touching this order', async () => {
    const id = await newOrder();
    await db.asUser(campus.otherStaff);
    await expectError(() => move(id, 'accepted'), 'FORBIDDEN');
  });

  it('stops an unrelated student touching this order', async () => {
    const id = await newOrder();
    await db.asUser(campus.otherStudent);
    await expectError(() => move(id, 'cancelled'), 'FORBIDDEN');
  });

  it('stops a partner who does not hold the order from moving it', async () => {
    const id = await newOrder();
    await db.asUser(campus.staff);
    await move(id, 'accepted');
    await move(id, 'preparing');
    await move(id, 'ready');
    await db.asUser(campus.partner);
    await expectError(() => move(id, 'picked_up'), 'FORBIDDEN');
  });

  it('lets a student cancel while pending but not once the kitchen has committed', async () => {
    const cancellable = await newOrder();
    await db.asUser(campus.student);
    await move(cancellable, 'cancelled', 'changed my mind');
    expect(await statusOf(cancellable)).toBe('cancelled');

    const accepted = await newOrder();
    await db.asUser(campus.staff);
    await move(accepted, 'accepted');
    await db.asUser(campus.student);
    await expectError(() => move(accepted, 'cancelled'), 'INVALID_TRANSITION');
  });

  it('refuses any move out of a terminal state, admin included', async () => {
    const id = await newOrder();
    await db.asUser(campus.staff);
    await move(id, 'rejected', 'out of gas');
    await db.asUser(campus.admin);
    await expectError(() => move(id, 'accepted'), 'INVALID_TRANSITION');
    await expectError(() => move(id, 'cancelled'), 'INVALID_TRANSITION');
  });

  it('fails a pending payment when the order is cancelled', async () => {
    const id = await newOrder();
    await db.asUser(campus.staff);
    await move(id, 'rejected', 'kitchen closed early');

    await db.asOwner();
    const { rows } = await db.query<{ status: string; failure_reason: string }>(
      `select status, failure_reason from public.payments where order_id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ status: 'failed', failure_reason: 'kitchen closed early' });
  });
});

describe('delivery claiming', () => {
  /** An order sitting in the pool. */
  async function readyOrder(): Promise<string> {
    const id = await newOrder();
    await db.asUser(campus.staff);
    await move(id, 'accepted');
    await move(id, 'preparing');
    await move(id, 'ready');
    return id;
  }

  it('gives the order to the first partner and tells the second one why not', async () => {
    const id = await readyOrder();

    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);

    // The guard is `status = 'ready' and delivery_partner_id is null`, so the
    // second partner's UPDATE matches zero rows.
    await db.asUser(campus.otherPartner);
    await expectError(
      () => db.query(`select public.claim_delivery($1::uuid)`, [id]),
      'DELIVERY_ALREADY_CLAIMED',
    );

    await db.asOwner();
    const { rows } = await db.query<{ delivery_partner_id: string }>(
      `select delivery_partner_id from public.orders where id = $1`,
      [id],
    );
    expect(rows[0]!.delivery_partner_id).toBe(campus.partner);
  });

  it('refuses a claim on an order that is not ready', async () => {
    const id = await newOrder();
    await db.asUser(campus.partner);
    await expectError(
      () => db.query(`select public.claim_delivery($1::uuid)`, [id]),
      'DELIVERY_ALREADY_CLAIMED',
    );
  });

  it('refuses a partner who has not been approved', async () => {
    const id = await readyOrder();
    await db.asOwner();
    await db.query(
      `update public.delivery_partners set is_approved = false where profile_id = $1`,
      [campus.partner],
    );
    await db.asUser(campus.partner);
    await expectError(() => db.query(`select public.claim_delivery($1::uuid)`, [id]), 'FORBIDDEN');

    await db.asOwner();
    await db.query(`update public.delivery_partners set is_approved = true where profile_id = $1`, [
      campus.partner,
    ]);
  });

  it('refuses a student pretending to be a partner', async () => {
    const id = await readyOrder();
    await db.asUser(campus.student);
    await expectError(() => db.query(`select public.claim_delivery($1::uuid)`, [id]), 'FORBIDDEN');
  });

  it('returns a released order to the pool, unassigned', async () => {
    const id = await readyOrder();
    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);
    await db.query(`select public.release_delivery($1::uuid)`, [id]);

    await db.asOwner();
    const { rows } = await db.query<{ status: string; delivery_partner_id: string | null }>(
      `select status, delivery_partner_id from public.orders where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ status: 'ready', delivery_partner_id: null });

    // And the next partner can now take it.
    await db.asUser(campus.otherPartner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);
    expect(await statusOf(id)).toBe('assigned');
  });
});
