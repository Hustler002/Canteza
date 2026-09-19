import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectError, seedCampus, type Campus, type Db } from './harness';

/**
 * Who may change what about a canteen.
 *
 * The split is the point: a canteen account owns its hours and its pause switch, and
 * nothing else. Everything that decides what the canteen *is* — its name, its minimum
 * order, whether it exists for students at all — is the admin's, and reaches the table
 * only through a `security definer` function.
 *
 * That cannot be expressed with policies alone. Admins and canteen staff are both the
 * `authenticated` role, and a column grant is per role, so the grant draws the staff
 * line and the functions carry the admin's wider reach.
 */

let db: Db;
let campus: Campus;

beforeAll(async () => {
  db = await createTestDb();
  campus = await seedCampus(db);
});
afterAll(async () => {
  await db?.close();
});

const canteen = async (id: string) => {
  await db.asOwner();
  const { rows } = await db.query<{
    name: string;
    opens_at: string;
    closes_at: string;
    min_order_paise: number;
    is_accepting_orders: boolean;
    is_active: boolean;
    phone: string | null;
  }>(
    `select name, opens_at, closes_at, min_order_paise, is_accepting_orders, is_active, phone
       from public.canteens where id = $1`,
    [id],
  );
  return rows[0]!;
};

describe('what a canteen account may write about itself', () => {
  it('sets its own hours and pause switch', async () => {
    await db.asUser(campus.staff);
    await db.query(
      `update public.canteens
          set opens_at = '09:30', closes_at = '21:00', is_accepting_orders = false
        where id = $1`,
      [campus.mainCanteen],
    );

    const row = await canteen(campus.mainCanteen);
    expect(row.opens_at).toBe('09:30:00');
    expect(row.closes_at).toBe('21:00:00');
    expect(row.is_accepting_orders).toBe(false);
  });

  it('cannot rename itself', async () => {
    // The name is snapshotted onto every order as canteen_name_snapshot, so letting a
    // canteen rewrite it would quietly rewrite what past receipts say they bought from.
    await db.asUser(campus.staff);
    await expect(
      db.query(`update public.canteens set name = 'Main Canteen Deluxe' where id = $1`, [
        campus.mainCanteen,
      ]),
    ).rejects.toThrow(/permission denied/i);

    expect((await canteen(campus.mainCanteen)).name).toBe('Main Canteen');
  });

  it('cannot disable itself, or change its own minimum order', async () => {
    await db.asUser(campus.staff);
    await expect(
      db.query(`update public.canteens set is_active = false where id = $1`, [campus.mainCanteen]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`update public.canteens set min_order_paise = 0 where id = $1`, [
        campus.mainCanteen,
      ]),
    ).rejects.toThrow(/permission denied/i);

    const row = await canteen(campus.mainCanteen);
    expect(row.is_active).toBe(true);
    expect(row.min_order_paise).toBe(5000);
  });

  it('still cannot reach another canteen, even on a column it owns', async () => {
    await db.asUser(campus.otherStaff); // Juice Corner
    const { rows } = await db.query(
      `update public.canteens set is_accepting_orders = false where id = $1 returning id`,
      [campus.mainCanteen],
    );
    // The row policy filters it out rather than raising: zero rows, nothing changed.
    expect(rows).toHaveLength(0);
    expect((await canteen(campus.mainCanteen)).is_accepting_orders).toBe(false);
  });
});

describe('admin_update_canteen', () => {
  it('writes the fields the staff grant withholds', async () => {
    await db.asUser(campus.admin);
    await db.query(
      `select public.admin_update_canteen($1::uuid, $2, $3, $4, $5, $6::integer,
                                          $7::time, $8::time, $9::boolean)`,
      [
        campus.mainCanteen,
        'Main Canteen',
        'The big one near the academic block.',
        null, // clearing the phone: a plain assignment can express this, a patch could not
        null,
        7500,
        '08:00',
        '22:00',
        true,
      ],
    );

    const row = await canteen(campus.mainCanteen);
    expect(row.min_order_paise).toBe(7500);
    expect(row.phone).toBeNull();
    expect(row.is_accepting_orders).toBe(true);
    expect(row.opens_at).toBe('08:00:00');
  });

  it('refuses canteen staff and students alike', async () => {
    for (const impostor of [campus.staff, campus.student]) {
      await db.asUser(impostor);
      await expectError(
        () =>
          db.query(
            `select public.admin_update_canteen($1::uuid, $2, $3, $4, $5, $6::integer,
                                                $7::time, $8::time, $9::boolean)`,
            [campus.mainCanteen, 'Hijacked', '', null, null, 0, '00:00', '00:00', true],
          ),
        'FORBIDDEN',
      );
    }
    expect((await canteen(campus.mainCanteen)).name).toBe('Main Canteen');
  });

  it('refuses a blank name rather than storing one', async () => {
    await db.asUser(campus.admin);
    await expectError(
      () =>
        db.query(
          `select public.admin_update_canteen($1::uuid, $2, $3, $4, $5, $6::integer,
                                              $7::time, $8::time, $9::boolean)`,
          [campus.mainCanteen, '   ', '', null, null, 0, '08:00', '22:00', true],
        ),
      'NOT_FOUND',
    );
  });
});

describe('admin_set_canteen_active', () => {
  it('hides a disabled canteen from students but keeps its rows', async () => {
    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_canteen_active($1::uuid, false)`, [campus.juiceCorner]);

    expect((await canteen(campus.juiceCorner)).is_active).toBe(false);

    // Gone from the students' view...
    await db.asUser(campus.student);
    const visible = await db.query(`select id from public.canteens_public where id = $1`, [
      campus.juiceCorner,
    ]);
    expect(visible.rows).toHaveLength(0);

    // ...but the menu it sold from is still there, so old orders still resolve.
    await db.asOwner();
    const items = await db.query(`select id from public.menu_items where canteen_id = $1`, [
      campus.juiceCorner,
    ]);
    expect(items.rows.length).toBeGreaterThan(0);
  });

  it('brings it back', async () => {
    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_canteen_active($1::uuid, true)`, [campus.juiceCorner]);
    expect((await canteen(campus.juiceCorner)).is_active).toBe(true);
  });

  it('refuses a non-admin', async () => {
    await db.asUser(campus.otherStaff);
    await expectError(
      () =>
        db.query(`select public.admin_set_canteen_active($1::uuid, false)`, [campus.juiceCorner]),
      'FORBIDDEN',
    );
    expect((await canteen(campus.juiceCorner)).is_active).toBe(true);
  });

  it('says so when the canteen does not exist', async () => {
    await db.asUser(campus.admin);
    await expectError(
      () =>
        db.query(`select public.admin_set_canteen_active($1::uuid, false)`, [
          '00000000-0000-4000-8000-00000000dead',
        ]),
      'NOT_FOUND',
    );
  });
});

describe('admin_create_canteen', () => {
  const create = (name: string, minOrder = 0) =>
    db.query<{ id: string }>(
      `select public.admin_create_canteen($1, $2, $3, $4, $5::integer, $6::time, $7::time) as id`,
      [name, 'A new place.', '+91 98100 09999', null, minOrder, '09:00', '18:00'],
    );

  it('creates it switched off, so students do not meet an empty canteen', async () => {
    await db.asUser(campus.admin);
    const { rows } = await create('Library Cafe', 2500);
    const id = rows[0]!.id;

    const row = await canteen(id);
    expect(row.is_active).toBe(false);
    // The pause switch keeps its default: nothing to un-pause once it is enabled.
    expect(row.is_accepting_orders).toBe(true);
    expect(row.min_order_paise).toBe(2500);

    await db.asUser(campus.student);
    const visible = await db.query(`select id from public.canteens_public where id = $1`, [id]);
    expect(visible.rows).toHaveLength(0);

    // And the admin's own switch is what puts it on campus.
    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_canteen_active($1::uuid, true)`, [id]);
    await db.asUser(campus.student);
    const nowVisible = await db.query(`select id from public.canteens_public where id = $1`, [id]);
    expect(nowVisible.rows).toHaveLength(1);
  });

  it('refuses a canteen account and a student', async () => {
    for (const impostor of [campus.staff, campus.student]) {
      await db.asUser(impostor);
      await expectError(() => create('Rogue Canteen'), 'FORBIDDEN');
    }

    await db.asOwner();
    const { rows } = await db.query(`select id from public.canteens where name = 'Rogue Canteen'`);
    expect(rows).toHaveLength(0);
  });

  it('refuses a blank name', async () => {
    await db.asUser(campus.admin);
    await expectError(() => create('   '), 'NOT_FOUND');
  });

  it('refuses a name another canteen already has', async () => {
    await db.asUser(campus.admin);
    await expect(create('Main Canteen')).rejects.toThrow(/unique|duplicate key/i);
  });
});

describe('canteens are RPC-only for writes', () => {
  it('nobody may insert or delete one directly, admin included', async () => {
    // Deleting would cascade canteen_staff and delivery_partners and orphan every
    // order placed there. Retiring is admin_set_canteen_active(id, false).
    await db.asUser(campus.admin);
    await expect(
      db.query(`insert into public.canteens (name) values ('Sneaky Canteen')`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`delete from public.canteens where id = $1`, [campus.juiceCorner]),
    ).rejects.toThrow(/permission denied/i);

    await db.asOwner();
    const { rows } = await db.query(`select id from public.canteens where id = $1`, [
      campus.juiceCorner,
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe('attaching canteen staff', () => {
  const attach = (profileId: string, canteenId: string) =>
    db.query(`select public.admin_attach_canteen_staff($1::uuid, $2::uuid)`, [
      profileId,
      canteenId,
    ]);
  const detach = (profileId: string, canteenId: string) =>
    db.query(`select public.admin_detach_canteen_staff($1::uuid, $2::uuid)`, [
      profileId,
      canteenId,
    ]);

  const membership = async (profileId: string) => {
    await db.asOwner();
    const { rows } = await db.query<{ canteen_id: string | null; role: string }>(
      `select cs.canteen_id, p.role
         from public.profiles p
         left join public.canteen_staff cs on cs.profile_id = p.id
        where p.id = $1`,
      [profileId],
    );
    return rows[0]!;
  };

  it('writes the membership and the role together', async () => {
    // The row is what my_canteen_id() reads; the role is what the app routes on.
    // Either one alone is a broken account.
    await db.asUser(campus.admin);
    await attach(campus.otherStudent, campus.hostelCanteen);

    expect(await membership(campus.otherStudent)).toEqual({
      canteen_id: campus.hostelCanteen,
      role: 'canteen',
    });

    await db.asUser(campus.otherStudent);
    const { rows } = await db.query<{ id: string | null }>(`select public.my_canteen_id() as id`);
    expect(rows[0]!.id).toBe(campus.hostelCanteen);
  });

  it('works on a canteen that is still disabled', async () => {
    // The whole point of creating a canteen switched off: staff and menu go in first.
    await db.asUser(campus.admin);
    const { rows } = await db.query<{ id: string }>(
      `select public.admin_create_canteen('Staffing Test', '', null, null, 0,
                                          '09:00'::time, '17:00'::time) as id`,
    );
    const fresh = rows[0]!.id;
    expect((await canteen(fresh)).is_active).toBe(false);

    await db.asUser(campus.admin);
    await attach(campus.otherStudent, fresh);
    expect((await membership(campus.otherStudent)).canteen_id).toBe(fresh);
  });

  it('moves someone who already works elsewhere, leaving one posting', async () => {
    await db.asUser(campus.admin);
    await attach(campus.otherStudent, campus.juiceCorner);

    await db.asOwner();
    const { rows } = await db.query(
      `select canteen_id from public.canteen_staff where profile_id = $1`,
      [campus.otherStudent],
    );
    expect(rows).toEqual([{ canteen_id: campus.juiceCorner }]);
  });

  it('refuses someone who still has a delivery posting', async () => {
    // transition_order would resolve them as 'canteen' on their own canteen's orders,
    // so they could claim a delivery and never be able to mark it picked up.
    await db.asUser(campus.admin);
    await expectError(() => attach(campus.partner, campus.mainCanteen), 'ALREADY_DELIVERY_PARTNER');

    expect((await membership(campus.partner)).canteen_id).toBeNull();
    expect((await membership(campus.partner)).role).toBe('delivery');
  });

  it('detaching removes the posting and puts the role back', async () => {
    await db.asUser(campus.admin);
    await detach(campus.otherStudent, campus.juiceCorner);

    expect(await membership(campus.otherStudent)).toEqual({ canteen_id: null, role: 'student' });
  });

  it('never demotes an admin who also works a counter', async () => {
    await db.asUser(campus.admin);
    await attach(campus.admin, campus.hostelCanteen);
    expect((await membership(campus.admin)).role).toBe('admin');

    await db.asUser(campus.admin);
    await detach(campus.admin, campus.hostelCanteen);
    expect(await membership(campus.admin)).toEqual({ canteen_id: null, role: 'admin' });
  });

  it('says so when the person is not staff there', async () => {
    await db.asUser(campus.admin);
    await expectError(() => detach(campus.otherStudent, campus.juiceCorner), 'NOT_FOUND');
  });

  it('refuses a canteen account and a student', async () => {
    for (const impostor of [campus.staff, campus.student]) {
      await db.asUser(impostor);
      await expectError(() => attach(campus.otherStudent, campus.mainCanteen), 'FORBIDDEN');
      await expectError(() => detach(campus.staff, campus.mainCanteen), 'FORBIDDEN');
    }
    expect((await membership(campus.staff)).canteen_id).toBe(campus.mainCanteen);
  });

  it('is the only way a membership changes', async () => {
    await db.asUser(campus.admin);
    await expect(
      db.query(`insert into public.canteen_staff (canteen_id, profile_id) values ($1, $2)`, [
        campus.juiceCorner,
        campus.otherStudent,
      ]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`delete from public.canteen_staff where profile_id = $1`, [campus.staff]),
    ).rejects.toThrow(/permission denied/i);
  });
});
