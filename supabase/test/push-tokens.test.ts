import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, seedCampus, type Campus, type Db } from './harness';

/**
 * `push_tokens`: which device belongs to whom.
 *
 * The rule worth pinning is the one a naive table gets wrong: a device has one person
 * signed in at a time, so registering a token someone else held must *move* it. Get this
 * wrong and a phone handed to a friend keeps lighting up with the previous owner's order
 * updates -- their name, their room number, on someone else's lock screen.
 */

let db: Db;
let campus: Campus;
let n = 0;
const token = () => `ExponentPushToken[test-${n++}-abcdef]`;

beforeAll(async () => {
  db = await createTestDb();
  campus = await seedCampus(db);
});
afterAll(async () => {
  await db?.close();
});

async function owner(tokenValue: string): Promise<string | null> {
  await db.asOwner();
  const { rows } = await db.query<{ user_id: string }>(
    `select user_id from public.push_tokens where token = $1`,
    [tokenValue],
  );
  return rows[0]?.user_id ?? null;
}

async function register(user: string, tokenValue: string, platform = 'android') {
  await db.asUser(user);
  await db.query(`select public.register_push_token($1, $2)`, [tokenValue, platform]);
}

describe('register_push_token', () => {
  it('records the device against whoever is signed in', async () => {
    const t = token();
    await register(campus.student, t);
    expect(await owner(t)).toBe(campus.student);
  });

  it('is idempotent: registering again on every app start adds nothing', async () => {
    const t = token();
    await register(campus.student, t);
    await register(campus.student, t);
    await db.asOwner();
    const { rows } = await db.query<{ n: string }>(
      `select count(*) as n from public.push_tokens where token = $1`,
      [t],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('moves a device to the next person who signs in on it', async () => {
    const t = token();
    await register(campus.student, t);
    await register(campus.staff, t);
    // The student's order updates must stop arriving on a phone the counter now uses.
    expect(await owner(t)).toBe(campus.staff);
  });

  it('keeps a person on several devices', async () => {
    const phone = token();
    const tablet = token();
    await register(campus.otherStudent, phone);
    await register(campus.otherStudent, tablet, 'ios');
    expect(await owner(phone)).toBe(campus.otherStudent);
    expect(await owner(tablet)).toBe(campus.otherStudent);
  });

  it('refuses anything that is not an Expo push token', async () => {
    for (const bad of ['', 'not-a-token', 'ExponentPushToken[]', 'ExponentPushToken[a b]']) {
      await expect(register(campus.student, bad)).rejects.toThrow(/check constraint/i);
    }
  });

  it('refuses an unknown platform', async () => {
    await expect(register(campus.student, token(), 'windows')).rejects.toThrow(/check constraint/i);
  });

  it('refuses a caller who is not signed in', async () => {
    await db.asOwner(); // no auth.uid()
    await expect(
      db.query(`select public.register_push_token($1, 'android')`, [token()]),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

describe('what a client can do to the table directly', () => {
  it('reads its own devices and nobody else’s', async () => {
    const mine = token();
    const theirs = token();
    await register(campus.student, mine);
    await register(campus.otherStudent, theirs);

    await db.asUser(campus.student);
    const { rows } = await db.query<{ token: string }>(`select token from public.push_tokens`);
    const seen = rows.map((r) => r.token);
    expect(seen).toContain(mine);
    expect(seen).not.toContain(theirs);
  });

  it('cannot insert a row, so cannot bypass the move-on-register rule', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(
        `insert into public.push_tokens (token, user_id, platform) values ($1, $2, 'android')`,
        [token(), campus.student],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('cannot reassign a device by update', async () => {
    const t = token();
    await register(campus.student, t);
    await db.asUser(campus.student);
    await expect(
      db.query(`update public.push_tokens set user_id = $1 where token = $2`, [campus.staff, t]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('deletes its own device at sign-out', async () => {
    const t = token();
    await register(campus.student, t);
    await db.asUser(campus.student);
    await db.query(`delete from public.push_tokens where token = $1`, [t]);
    expect(await owner(t)).toBeNull();
  });

  it('cannot delete someone else’s — the delete matches nothing', async () => {
    const t = token();
    await register(campus.otherStudent, t);
    await db.asUser(campus.student);
    await db.query(`delete from public.push_tokens where token = $1`, [t]);
    expect(await owner(t)).toBe(campus.otherStudent);
  });
});

describe('an account that goes away', () => {
  it('takes its devices with it', async () => {
    const user = await db.createUser('leaving@campus.edu');
    const t = token();
    await register(user, t);
    await db.asOwner();
    await db.query(`delete from auth.users where id = $1`, [user]);
    expect(await owner(t)).toBeNull();
  });
});
