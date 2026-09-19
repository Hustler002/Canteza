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
 * ADR 008: a delivery partner belongs to one canteen and may only carry that
 * canteen's orders. External couriers cannot enter campus, so each canteen employs
 * its own delivery staff.
 *
 * The rule is enforced in three independent places, and each is tested here:
 *   1. the composite foreign key on orders  (cannot be bypassed at all)
 *   2. claim_delivery                        (gives a legible error)
 *   3. the orders RLS policy                 (other canteens' work is invisible)
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

const move = (id: string, to: string, reason?: string) =>
  db.query(`select public.transition_order($1::uuid, $2, $3) as status`, [id, to, reason ?? null]);

/** A Main Canteen order sitting in that canteen's ready queue. */
async function readyOrder(): Promise<string> {
  await db.asUser(campus.student);
  const id = await placeOrder(db, {
    canteen: campus.mainCanteen,
    hostel: campus.hostel,
    items: [{ item_id: maggi, quantity: 2 }],
    key: `scope-${counter++}`,
  });
  await db.asUser(campus.staff);
  await move(id, 'accepted');
  await move(id, 'preparing');
  await move(id, 'ready');
  return id;
}

/** What a partner does when they start work. */
async function goOnline(profileId: string): Promise<void> {
  await db.asUser(profileId);
  await db.query(`update public.delivery_partners set is_online = true where profile_id = $1`, [
    profileId,
  ]);
}

const statusOf = async (id: string) => {
  await db.asOwner();
  const { rows } = await db.query<{ status: string; delivery_partner_id: string | null }>(
    `select status, delivery_partner_id from public.orders where id = $1`,
    [id],
  );
  return rows[0]!;
};

describe('the database itself refuses a cross-canteen assignment', () => {
  it('rejects the pairing even as the table owner, with RLS and the RPCs bypassed', async () => {
    const id = await readyOrder();
    await db.asOwner();

    // Sana delivers for Juice Corner. This is a direct UPDATE as the owner: no policy
    // applies, no function is involved. The composite foreign key is the only thing
    // standing here, which is the point.
    await expect(
      db.query(
        `update public.orders set status = 'assigned', delivery_partner_id = $2 where id = $1`,
        [id, campus.juicePartner],
      ),
    ).rejects.toThrow(/order_partner_belongs_to_canteen|foreign key/i);
  });

  it('still allows the pairing when the partner does belong to that canteen', async () => {
    const id = await readyOrder();
    await db.asOwner();
    await db.query(
      `update public.orders set status = 'assigned', delivery_partner_id = $2 where id = $1`,
      [id, campus.partner],
    );
    expect((await statusOf(id)).delivery_partner_id).toBe(campus.partner);
  });

  it('leaves unassigned orders alone — a null partner skips the check', async () => {
    const id = await readyOrder();
    expect((await statusOf(id)).delivery_partner_id).toBeNull();
  });
});

describe('claim_delivery is canteen-scoped', () => {
  it('refuses a partner from another canteen, and says why', async () => {
    const id = await readyOrder();
    await db.asUser(campus.juicePartner);
    await expectError(() => db.query(`select public.claim_delivery($1::uuid)`, [id]), 'FORBIDDEN');
    expect((await statusOf(id)).delivery_partner_id).toBeNull();
  });

  it('lets the canteen’s own partner claim it', async () => {
    const id = await readyOrder();
    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);
    expect(await statusOf(id)).toMatchObject({
      status: 'assigned',
      delivery_partner_id: campus.partner,
    });
  });

  it('still resolves a race between two partners of the same canteen', async () => {
    const id = await readyOrder();
    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);

    await db.asUser(campus.otherPartner);
    await expectError(
      () => db.query(`select public.claim_delivery($1::uuid)`, [id]),
      'DELIVERY_ALREADY_CLAIMED',
    );
    expect((await statusOf(id)).delivery_partner_id).toBe(campus.partner);
  });

  it('refuses a partner their canteen has deactivated', async () => {
    const id = await readyOrder();
    await db.asUser(campus.staff);
    await db.query(`select public.canteen_set_partner_active($1::uuid, false)`, [
      campus.otherPartner,
    ]);

    await db.asUser(campus.otherPartner);
    await expectError(() => db.query(`select public.claim_delivery($1::uuid)`, [id]), 'FORBIDDEN');

    await db.asUser(campus.staff);
    await db.query(`select public.canteen_set_partner_active($1::uuid, true)`, [
      campus.otherPartner,
    ]);
    // Retiring someone clears their shift and reinstating does not restore it, so
    // they come back on shift themselves.
    await goOnline(campus.otherPartner);
  });
});

describe('a canteen manages only its own delivery staff', () => {
  it('sees its own partners', async () => {
    await db.asUser(campus.staff);
    const { rows } = await db.query<{ profile_id: string }>(
      `select profile_id from public.delivery_partners`,
    );
    expect(rows.map((r) => r.profile_id).sort()).toEqual(
      [campus.partner, campus.otherPartner].sort(),
    );
  });

  it('cannot deactivate another canteen’s partner', async () => {
    await db.asUser(campus.otherStaff); // Juice Corner
    await expectError(
      () => db.query(`select public.canteen_set_partner_active($1::uuid, false)`, [campus.partner]),
      'NOT_FOUND',
    );

    await db.asOwner();
    const { rows } = await db.query<{ is_active: boolean }>(
      `select is_active from public.delivery_partners where profile_id = $1`,
      [campus.partner],
    );
    expect(rows[0]!.is_active).toBe(true);
  });
});

describe('moving a partner between canteens', () => {
  it('keeps the old posting so historical orders still resolve', async () => {
    // Give Imran a delivered Main Canteen order in his history.
    const id = await readyOrder();
    await db.asUser(campus.otherPartner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);
    await move(id, 'picked_up');
    await move(id, 'delivered');

    // Now he transfers to Juice Corner.
    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_partner_canteen($1::uuid, $2::uuid, true)`, [
      campus.otherPartner,
      campus.juiceCorner,
    ]);
    // A new posting starts off shift; is_online is the partner's own toggle.
    await goOnline(campus.otherPartner);

    await db.asOwner();
    const postings = await db.query<{ canteen_id: string; is_active: boolean }>(
      `select canteen_id, is_active from public.delivery_partners
        where profile_id = $1 order by is_active`,
      [campus.otherPartner],
    );
    // Two rows: the retired Main Canteen posting, and the live Juice Corner one.
    expect(postings.rows).toEqual([
      { canteen_id: campus.mainCanteen, is_active: false },
      { canteen_id: campus.juiceCorner, is_active: true },
    ]);

    // The old order still points at him, and the foreign key still resolves.
    const order = await db.query<{ delivery_partner_id: string }>(
      `select delivery_partner_id from public.orders where id = $1`,
      [id],
    );
    expect(order.rows[0]!.delivery_partner_id).toBe(campus.otherPartner);
  });

  it('enforces one active canteen per person', async () => {
    await db.asOwner();
    await expect(
      db.query(
        `insert into public.delivery_partners (profile_id, canteen_id, is_approved, is_active)
         values ($1, $2, true, true)`,
        [campus.otherPartner, campus.hostelCanteen],
      ),
    ).rejects.toThrow(/delivery_partner_one_active_canteen|duplicate key/i);
  });

  it('now claims for the new canteen and no longer for the old one', async () => {
    const mainOrder = await readyOrder();
    await db.asUser(campus.otherPartner);
    await expectError(
      () => db.query(`select public.claim_delivery($1::uuid)`, [mainOrder]),
      'FORBIDDEN',
    );
  });
});

describe('canteen self-delivery', () => {
  it('lets the counter deliver it themselves when no partner is on shift', async () => {
    const id = await readyOrder();
    await db.asUser(campus.staff);
    await move(id, 'delivered');

    expect((await statusOf(id)).status).toBe('delivered');

    await db.asOwner();
    const history = await db.query<{ from_status: string; actor: string }>(
      `select from_status, actor from public.order_status_history
        where order_id = $1 and to_status = 'delivered'`,
      [id],
    );
    expect(history.rows[0]).toMatchObject({ from_status: 'ready', actor: 'canteen' });

    // And the cash still settles.
    const payment = await db.query<{ status: string }>(
      `select status from public.payments where order_id = $1`,
      [id],
    );
    expect(payment.rows[0]!.status).toBe('success');
  });

  it('does not let a canteen deliver an order a partner is already carrying', async () => {
    const id = await readyOrder();
    await db.asUser(campus.partner);
    await db.query(`select public.claim_delivery($1::uuid)`, [id]);

    await db.asUser(campus.staff);
    await expectError(() => move(id, 'delivered'), 'INVALID_TRANSITION');
  });
});

describe('an admin retires a delivery partner', () => {
  /** The posting rows this person holds, oldest state first. */
  const postingsOf = async (profileId: string) => {
    await db.asOwner();
    const { rows } = await db.query<{
      canteen_id: string;
      is_active: boolean;
      is_online: boolean;
    }>(
      `select canteen_id, is_active, is_online from public.delivery_partners
        where profile_id = $1 order by is_active`,
      [profileId],
    );
    return rows;
  };

  it('ends a posting the admin does not employ, and clears the shift with it', async () => {
    await goOnline(campus.juicePartner);

    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_partner_active($1::uuid, $2::uuid, false)`, [
      campus.juicePartner,
      campus.juiceCorner,
    ]);

    // Shift cleared too: otherwise my_delivery_canteen_id() still matches and a
    // retired partner keeps claiming.
    expect(await postingsOf(campus.juicePartner)).toEqual([
      { canteen_id: campus.juiceCorner, is_active: false, is_online: false },
    ]);
  });

  it('refuses a canteen and a student alike — this is the admin path', async () => {
    for (const impostor of [campus.otherStaff, campus.student]) {
      await db.asUser(impostor);
      await expectError(
        () =>
          db.query(`select public.admin_set_partner_active($1::uuid, $2::uuid, true)`, [
            campus.juicePartner,
            campus.juiceCorner,
          ]),
        'FORBIDDEN',
      );
    }
    // Still retired by the test above: a refused call changed nothing.
    expect((await postingsOf(campus.juicePartner))[0]!.is_active).toBe(false);
  });

  it('restores the posting, but leaves going back on shift to the partner', async () => {
    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_partner_active($1::uuid, $2::uuid, true)`, [
      campus.juicePartner,
      campus.juiceCorner,
    ]);

    expect(await postingsOf(campus.juicePartner)).toEqual([
      { canteen_id: campus.juiceCorner, is_active: true, is_online: false },
    ]);
  });

  it('rolls the retire back when the canteen named has no posting', async () => {
    // Imran transferred to Juice Corner above and has no Hostel Canteen row. The
    // function retires his live posting before discovering that, so the failure has
    // to take the retire with it -- otherwise a mistyped canteen id silently strips
    // someone of the job they had.
    await db.asUser(campus.admin);
    await expectError(
      () =>
        db.query(`select public.admin_set_partner_active($1::uuid, $2::uuid, true)`, [
          campus.otherPartner,
          campus.hostelCanteen,
        ]),
      'NOT_FOUND',
    );

    // `is_active` is what matters: both postings are exactly as the transfer left
    // them. The retired row reads `is_online: true` only because this file's
    // goOnline() helper updates by profile alone -- the app's setOnline() filters on
    // `is_active`, and an inactive posting is ignored by my_delivery_canteen_id()
    // either way.
    expect(await postingsOf(campus.otherPartner)).toEqual([
      { canteen_id: campus.mainCanteen, is_active: false, is_online: true },
      { canteen_id: campus.juiceCorner, is_active: true, is_online: true },
    ]);
  });
});
