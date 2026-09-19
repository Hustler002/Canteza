import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, seedCampus, type Campus, type Db } from './harness';

/**
 * Table privileges, which are the half of the authorization model that RLS cannot do.
 *
 * Supabase grants select/insert/update/delete on every table in `public` to `anon`
 * and `authenticated` when a project is created. An RLS policy cannot restrict
 * *columns*, so those two facts combined were a privilege escalation: a student could
 * `update profiles set role = 'admin'` and the own-row policy would wave it through.
 *
 * The harness models those default grants, and the hardening migration takes them
 * back. These tests fail if either side of that is removed.
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

/** Columns of a table the role may actually write. */
async function writableColumns(role: string, table: string): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name
       from information_schema.column_privileges
      where grantee = $1 and table_schema = 'public' and table_name = $2
        and privilege_type = 'UPDATE'
      order by column_name`,
    [role, table],
  );
  return rows.map((r) => r.column_name);
}

async function hasTablePrivilege(role: string, table: string, priv: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, $2, $3) as ok`, [
    role,
    `public.${table}`,
    priv,
  ]);
  return rows[0]!.ok;
}

describe('the escalation that Supabase defaults would have opened', () => {
  it('a student cannot make themselves an admin', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(`update public.profiles set role = 'admin' where id = $1`, [campus.student]),
    ).rejects.toThrow(/permission denied/i);

    await db.asOwner();
    const { rows } = await db.query<{ role: string }>(
      `select role from public.profiles where id = $1`,
      [campus.student],
    );
    expect(rows[0]!.role).toBe('student');
  });

  it('a delivery partner cannot approve themselves', async () => {
    await db.asOwner();
    await db.query(
      `update public.delivery_partners set is_approved = false where profile_id = $1`,
      [campus.partner],
    );

    await db.asUser(campus.partner);
    await expect(
      db.query(`update public.delivery_partners set is_approved = true where profile_id = $1`, [
        campus.partner,
      ]),
    ).rejects.toThrow(/permission denied/i);

    await db.asOwner();
    const { rows } = await db.query<{ is_approved: boolean }>(
      `select is_approved from public.delivery_partners where profile_id = $1`,
      [campus.partner],
    );
    expect(rows[0]!.is_approved).toBe(false);
    await db.query(`update public.delivery_partners set is_approved = true where profile_id = $1`, [
      campus.partner,
    ]);
  });
});

describe('what authenticated may write, column by column', () => {
  it('on profiles: their own details, never their role', async () => {
    const columns = await writableColumns('authenticated', 'profiles');
    expect(columns).toEqual([
      'avatar_url',
      'default_block',
      'default_hostel_id',
      'default_room',
      'full_name',
      'phone',
    ]);
    expect(columns).not.toContain('role');
    expect(columns).not.toContain('is_active');
  });

  it('on delivery_partners: the shift toggle and nothing else', async () => {
    expect(await writableColumns('authenticated', 'delivery_partners')).toEqual(['is_online']);
  });

  it('on canteens: a canteen owns its hours and its pause switch, nothing more', async () => {
    // Admins are `authenticated` too, so this list binds them as well — their wider
    // reach is admin_update_canteen / admin_set_canteen_active, not a grant.
    expect(await writableColumns('authenticated', 'canteens')).toEqual([
      'closes_at',
      'is_accepting_orders',
      'opens_at',
    ]);
  });

  it('on notifications: marking one read, not rewriting it', async () => {
    expect(await writableColumns('authenticated', 'notifications')).toEqual(['read_at']);
  });

  it('on orders: nothing at all — every move belongs to an RPC', async () => {
    expect(await writableColumns('authenticated', 'orders')).toEqual([]);
    expect(await hasTablePrivilege('authenticated', 'orders', 'INSERT')).toBe(false);
    expect(await hasTablePrivilege('authenticated', 'orders', 'UPDATE')).toBe(false);
    expect(await hasTablePrivilege('authenticated', 'orders', 'DELETE')).toBe(false);
    expect(await hasTablePrivilege('authenticated', 'orders', 'SELECT')).toBe(true);
  });

  it('on the financial record: read only', async () => {
    for (const table of ['payments', 'order_items', 'order_status_history', 'coupon_redemptions']) {
      expect(await hasTablePrivilege('authenticated', table, 'INSERT')).toBe(false);
      expect(await hasTablePrivilege('authenticated', table, 'UPDATE')).toBe(false);
      expect(await hasTablePrivilege('authenticated', table, 'DELETE')).toBe(false);
    }
  });
});

describe('anon', () => {
  it('has no access to anything in public', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select distinct table_name
         from information_schema.table_privileges
        where grantee = 'anon' and table_schema = 'public'
        order by table_name`,
    );
    // Nobody browses without signing in, so anon needs nothing.
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});

describe('a table added by a future migration', () => {
  it('inherits no privileges, so forgetting a GRANT fails closed', async () => {
    await db.asOwner();
    await db.exec(`create table public.future_thing (id int primary key, secret text);`);

    // If the default privileges were still in place this would be true, and the new
    // table would be readable and writable by every signed-in user on day one.
    expect(await hasTablePrivilege('authenticated', 'future_thing', 'SELECT')).toBe(false);
    expect(await hasTablePrivilege('authenticated', 'future_thing', 'INSERT')).toBe(false);
    expect(await hasTablePrivilege('anon', 'future_thing', 'SELECT')).toBe(false);

    await db.exec(`drop table public.future_thing;`);
  });
});

describe('functions', () => {
  /**
   * Postgres grants EXECUTE to PUBLIC by default and we deliberately leave that in
   * place for the helpers: verified empirically that revoking is_admin() or
   * my_canteen_id() from PUBLIC makes every policy calling them fail with
   * "permission denied for function", because a policy expression is evaluated with
   * the querying user's privileges. So the test is not "nothing is callable" -- it is
   * "the function that can do damage is not".
   */
  it('does not let a client write notifications for other people', async () => {
    await db.asUser(campus.student);
    await expect(
      db.query(`select public.notify_order($1::uuid, 'pending', array['student','canteen'])`, [
        campus.student,
      ]),
    ).rejects.toThrow(/permission denied for function/i);
  });

  it('exposes every RPC the apps actually call', async () => {
    const { rows } = await db.query<{ proname: string; ok: boolean }>(
      `select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('place_order', 'transition_order', 'claim_delivery',
                            'release_delivery', 'admin_set_role',
                            'admin_set_partner_canteen', 'admin_set_partner_active',
                            'admin_update_canteen', 'admin_set_canteen_active',
                            'canteen_set_partner_active')`,
    );
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it('keeps the identity helpers callable, because RLS policies depend on it', async () => {
    // Not a hole: each reports only on the caller's own auth.uid().
    await db.asUser(campus.student);
    const { rows } = await db.query<{ role: string | null; canteen: string | null }>(
      `select public.auth_role() as role, public.my_canteen_id() as canteen`,
    );
    expect(rows[0]).toEqual({ role: 'student', canteen: null });
  });
});
