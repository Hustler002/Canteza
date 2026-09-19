import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectError, seedCampus, type Campus, type Db } from './harness';

/**
 * The admin's surface over accounts and hostels.
 *
 * Both areas share a shape worth stating: an admin may change what a row *is*, but the
 * two things that could lock the platform out of its own administration — demoting
 * yourself and suspending yourself — are refused at the database, not just hidden in a
 * page. There is no second way back in if either succeeds.
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

const profile = async (id: string) => {
  await db.asOwner();
  const { rows } = await db.query<{ role: string; is_active: boolean }>(
    `select role, is_active from public.profiles where id = $1`,
    [id],
  );
  return rows[0]!;
};

describe('admin_set_profile_active', () => {
  it('suspends an account, which is what the column was always for', async () => {
    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_profile_active($1::uuid, false)`, [
      campus.otherStudent,
    ]);
    expect((await profile(campus.otherStudent)).is_active).toBe(false);
  });

  it('takes a suspended partner off the delivery queue', async () => {
    // my_delivery_canteen_id() joins profiles and requires is_active, so this is the
    // behaviour the column existed for — and could not be exercised until now.
    await db.asUser(campus.partner);
    await db.query(`update public.delivery_partners set is_online = true where profile_id = $1`, [
      campus.partner,
    ]);
    const before = await db.query<{ id: string | null }>(
      `select public.my_delivery_canteen_id() as id`,
    );
    expect(before.rows[0]!.id).toBe(campus.mainCanteen);

    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_profile_active($1::uuid, false)`, [campus.partner]);

    await db.asUser(campus.partner);
    const after = await db.query<{ id: string | null }>(
      `select public.my_delivery_canteen_id() as id`,
    );
    expect(after.rows[0]!.id).toBeNull();

    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_profile_active($1::uuid, true)`, [campus.partner]);
  });

  it('restores one', async () => {
    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_profile_active($1::uuid, true)`, [campus.otherStudent]);
    expect((await profile(campus.otherStudent)).is_active).toBe(true);
  });

  it('refuses an admin suspending themselves out of the dashboard', async () => {
    await db.asUser(campus.admin);
    await expectError(
      () => db.query(`select public.admin_set_profile_active($1::uuid, false)`, [campus.admin]),
      'FORBIDDEN',
    );
    expect((await profile(campus.admin)).is_active).toBe(true);
  });

  it('refuses everyone who is not an admin', async () => {
    for (const impostor of [campus.staff, campus.student, campus.partner]) {
      await db.asUser(impostor);
      await expectError(
        () => db.query(`select public.admin_set_profile_active($1::uuid, false)`, [campus.student]),
        'FORBIDDEN',
      );
    }
    expect((await profile(campus.student)).is_active).toBe(true);
  });

  it('says so when the profile does not exist', async () => {
    await db.asUser(campus.admin);
    await expectError(
      () =>
        db.query(`select public.admin_set_profile_active($1::uuid, false)`, [
          '00000000-0000-4000-8000-00000000dead',
        ]),
      'NOT_FOUND',
    );
  });
});

describe('admin_set_role', () => {
  it('promotes and demotes someone else', async () => {
    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_role($1::uuid, 'admin')`, [campus.otherStudent]);
    expect((await profile(campus.otherStudent)).role).toBe('admin');

    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_role($1::uuid, 'student')`, [campus.otherStudent]);
    expect((await profile(campus.otherStudent)).role).toBe('student');
  });

  it('refuses an admin demoting themselves', async () => {
    // There is no way back: a demoted admin cannot promote themselves, and a sole admin
    // doing it locks every person out of the dashboard permanently.
    await db.asUser(campus.admin);
    await expectError(
      () => db.query(`select public.admin_set_role($1::uuid, 'student')`, [campus.admin]),
      'FORBIDDEN',
    );
    expect((await profile(campus.admin)).role).toBe('admin');
  });

  it('still lets an admin re-assert their own role, which changes nothing', async () => {
    await db.asUser(campus.admin);
    await db.query(`select public.admin_set_role($1::uuid, 'admin')`, [campus.admin]);
    expect((await profile(campus.admin)).role).toBe('admin');
  });

  it('still refuses an unknown role', async () => {
    await db.asUser(campus.admin);
    await expectError(
      () => db.query(`select public.admin_set_role($1::uuid, 'superuser')`, [campus.student]),
      'NOT_FOUND',
    );
  });
});

describe('hostels', () => {
  it('lets an admin add and edit one directly', async () => {
    // No column here needs withholding and no other role writes this table, so the
    // grant plus hostels_admin is the whole rule — no RPC to carry it.
    await db.asUser(campus.admin);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.hostels (name, blocks) values ('Kaveri Hostel', '{A,B}')
       returning id`,
    );
    const id = rows[0]!.id;

    await db.query(`update public.hostels set blocks = '{A,B,C}' where id = $1`, [id]);

    await db.asOwner();
    const { rows: after } = await db.query<{ blocks: string[] }>(
      `select blocks from public.hostels where id = $1`,
      [id],
    );
    expect(after[0]!.blocks).toEqual(['A', 'B', 'C']);
  });

  it('is disabled, never deleted — even by an admin', async () => {
    // Deleting nulls default_hostel_id for every student who lives there, and a hostel
    // with orders is refused by the foreign key anyway. Disabling keeps both.
    await db.asUser(campus.admin);
    await expect(
      db.query(`delete from public.hostels where id = $1`, [campus.hostel]),
    ).rejects.toThrow(/permission denied/i);

    await db.query(`update public.hostels set is_active = false where id = $1`, [campus.hostel]);
    await db.asOwner();
    const { rows } = await db.query<{ is_active: boolean }>(
      `select is_active from public.hostels where id = $1`,
      [campus.hostel],
    );
    expect(rows[0]!.is_active).toBe(false);

    await db.asUser(campus.admin);
    await db.query(`update public.hostels set is_active = true where id = $1`, [campus.hostel]);
  });

  it('refuses a student writing one', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(`insert into public.hostels (name) values ('Fake Hostel')`),
    ).rejects.toThrow(/row-level security/i);
  });
});
