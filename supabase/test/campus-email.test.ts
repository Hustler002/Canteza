import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isCampusEmail } from '@canteza/shared';
import { createTestDb, expectError, type Db } from './harness';

/**
 * Student sign-up by college email (the campus_email_signup migration). The hook is what
 * GoTrue calls before creating a user; the trigger stops a college account giving its
 * mailbox up for a second sign-up.
 */

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

// Every shape worth arguing about, allowed and refused.
const ADDRESSES = [
  'riya.2023@mnnit.ac.in',
  'RIYA.2023@MNNIT.AC.IN',
  ' riya@mnnit.ac.in ',
  'a_b-c@mnnit.ac.in',
  'riya+2@mnnit.ac.in',
  'riya@cse.mnnit.ac.in',
  'riya@mnnit.ac.in.evil.com',
  'riya@mnnitxac.in',
  'riya@gmail.com',
  'riya@campus.edu',
  '@mnnit.ac.in',
  'ri ya@mnnit.ac.in',
  '',
];

async function hook(email: string | null): Promise<Record<string, unknown>> {
  const event = { metadata: { name: 'before-user-created' }, user: { email } };
  const { rows } = await db.query<{ answer: Record<string, unknown> }>(
    `select public.hook_before_user_created($1::jsonb) as answer`,
    [JSON.stringify(event)],
  );
  return rows[0]!.answer;
}

describe('the rule', () => {
  it('agrees with the form, address for address', async () => {
    for (const email of ADDRESSES) {
      const { rows } = await db.query<{ ok: boolean }>(`select public.is_campus_email($1) as ok`, [
        email,
      ]);
      expect({ email, ok: rows[0]!.ok }).toEqual({ email, ok: isCampusEmail(email) });
    }
  });

  it('allows exactly the college mailboxes', () => {
    expect(ADDRESSES.filter(isCampusEmail)).toEqual([
      'riya.2023@mnnit.ac.in',
      'RIYA.2023@MNNIT.AC.IN',
      ' riya@mnnit.ac.in ',
      'a_b-c@mnnit.ac.in',
    ]);
  });
});

describe('the sign-up hook', () => {
  it('lets a college address through with an empty answer', async () => {
    expect(await hook('riya.2023@mnnit.ac.in')).toEqual({});
  });

  it('refuses anything else with a 403 the app can read', async () => {
    for (const email of ['riya@gmail.com', 'riya+2@mnnit.ac.in', '', null]) {
      const answer = await hook(email);
      expect(answer).toMatchObject({ error: { http_code: 403 } });
      expect((answer.error as { message: string }).message).toMatch(/^EMAIL_NOT_ALLOWED: /);
    }
  });

  it('is callable by GoTrue and by nobody on the API', async () => {
    const { rows } = await db.query<Record<string, boolean>>(`
      select
        has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute') as auth,
        has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute') as signed_in,
        has_function_privilege('authenticated', 'public.is_campus_email(text)', 'execute') as rule
    `);
    expect(rows[0]).toEqual({ auth: true, anon: false, signed_in: false, rule: false });
  });
});

describe('a college account keeps a college address', () => {
  let n = 0;
  const user = async (email: string) => {
    await db.asOwner();
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email) values ($1) returning id`,
      [email.replace('@', `${++n}@`)],
    );
    return rows[0]!.id;
  };
  const set = (id: string, column: 'email' | 'email_change', value: string) =>
    db.query(`update auth.users set ${column} = $2 where id = $1`, [id, value]);

  it('refuses moving it to a personal address, requested or confirmed', async () => {
    const id = await user('riya@mnnit.ac.in');
    await expectError(() => set(id, 'email_change', 'riya@gmail.com'), 'EMAIL_NOT_ALLOWED');
    await expectError(() => set(id, 'email', 'riya@gmail.com'), 'EMAIL_NOT_ALLOWED');
    await expectError(() => set(id, 'email', 'riya+2@mnnit.ac.in'), 'EMAIL_NOT_ALLOWED');
  });

  it('allows another college address, which still has to be confirmed from its mailbox', async () => {
    const id = await user('riya@mnnit.ac.in');
    await set(id, 'email_change', 'riya.new@mnnit.ac.in');
    await set(id, 'email', 'riya.new@mnnit.ac.in');
    await set(id, 'email_change', '');
  });

  it('leaves staff accounts alone -- they never had a college address', async () => {
    const id = await user('vikram@campus.edu');
    await set(id, 'email', 'vikram@gmail.com');
  });
});
