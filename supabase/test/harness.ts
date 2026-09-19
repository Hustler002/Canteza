import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * Runs the real migrations against an in-process Postgres (PGlite), so the SQL in
 * supabase/migrations is executed by these tests rather than merely written.
 *
 * Docker is not required. What PGlite cannot do is run two connections at once, so
 * these tests verify the *guards* that decide a race (the conditional UPDATE, the
 * unique constraint) rather than firing two transactions in parallel. Postgres
 * itself provides the atomicity; what we check here is that the guard exists and
 * that losing produces the right error. See supabase/test/README.md.
 */

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

/** Minimal stand-in for the parts of Supabase's `auth` schema the migrations touch. */
const AUTH_SHIM = `
  create schema if not exists auth;

  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text unique,
    raw_user_meta_data jsonb not null default '{}'
  );

  -- Supabase reads the subject claim of the verified JWT. In tests the claim is
  -- set directly, which is the same thing minus the signature check.
  create or replace function auth.uid() returns uuid
  language sql stable as $shim$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $shim$;

  create role anon;
  create role authenticated;
  create role service_role;
`;

export type Db = PGlite & {
  /** Run subsequent statements as this signed-in user, through RLS. */
  asUser(id: string): Promise<void>;
  /** Drop back to the owner role, bypassing RLS (used for fixtures and assertions). */
  asOwner(): Promise<void>;
  /** Create an auth user plus its profile, returning the id. */
  createUser(email: string, role?: string, fullName?: string): Promise<string>;
};

export async function createTestDb(): Promise<Db> {
  const pg = await PGlite.create();

  await pg.exec(AUTH_SHIM);

  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    try {
      await pg.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }

  const asOwner = async (): Promise<void> => {
    await pg.exec(`reset role;`);
    await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
  };

  const asUser = async (id: string): Promise<void> => {
    await pg.exec(`reset role;`);
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
    await pg.exec(`set role authenticated;`);
  };

  const createUser = async (email: string, role = 'student', fullName = email): Promise<string> => {
    await asOwner();
    const { rows } = await pg.query<{ id: string }>(
      `insert into auth.users (email) values ($1) returning id`,
      [email],
    );
    const id = rows[0]!.id;
    // The on-auth-user-created trigger already inserted the profile.
    await pg.query(`update public.profiles set role = $2, full_name = $3 where id = $1`, [
      id,
      role,
      fullName,
    ]);
    return id;
  };

  // Object.assign rather than a cast: the cast was unsound, because the methods do
  // not exist on the value at the moment it claims to be a Db.
  return Object.assign(pg, { asUser, asOwner, createUser });
}

const SEED = fileURLToPath(new URL('../seed.sql', import.meta.url));

export type Campus = {
  student: string;
  otherStudent: string;
  staff: string;
  otherStaff: string;
  /** Delivers for Main Canteen. */
  partner: string;
  /** Also delivers for Main Canteen -- the one who loses the claim race. */
  otherPartner: string;
  /** Delivers for Juice Corner. Must never see a Main Canteen order. */
  juicePartner: string;
  admin: string;
  mainCanteen: string;
  juiceCorner: string;
  hostelCanteen: string;
  hostel: string;
};

/**
 * Loads the real seed file, then a standard cast of users.
 *
 * Canteen hours are forced to always-open: the seeded hours are real ones, and a
 * test that only passes between 08:00 and 22:00 IST is a test that fails at night.
 */
export async function seedCampus(db: Db): Promise<Campus> {
  await db.asOwner();
  await db.exec(readFileSync(SEED, 'utf8'));
  await db.exec(`update public.canteens set opens_at = '00:00', closes_at = '00:00';`);

  const mainCanteen = 'c0000000-0000-4000-8000-000000000001';
  const hostelCanteen = 'c0000000-0000-4000-8000-000000000002';
  const juiceCorner = 'c0000000-0000-4000-8000-000000000004';

  const cast = {
    student: await db.createUser('riya@campus.edu', 'student', 'Riya Sharma'),
    otherStudent: await db.createUser('arjun@campus.edu', 'student', 'Arjun Nair'),
    staff: await db.createUser('main@campus.edu', 'canteen', 'Main Canteen Counter'),
    otherStaff: await db.createUser('juice@campus.edu', 'canteen', 'Juice Corner Counter'),
    partner: await db.createUser('vikram@campus.edu', 'delivery', 'Vikram Singh'),
    otherPartner: await db.createUser('imran@campus.edu', 'delivery', 'Imran Qureshi'),
    juicePartner: await db.createUser('sana@campus.edu', 'delivery', 'Sana Khan'),
    admin: await db.createUser('admin@campus.edu', 'admin', 'Platform Admin'),
    mainCanteen,
    juiceCorner,
    hostelCanteen,
    hostel: 'a0000000-0000-4000-8000-000000000001',
  };

  await db.query(`insert into public.canteen_staff (canteen_id, profile_id) values ($1, $2)`, [
    mainCanteen,
    cast.staff,
  ]);
  await db.query(`insert into public.canteen_staff (canteen_id, profile_id) values ($1, $2)`, [
    juiceCorner,
    cast.otherStaff,
  ]);
  // Partners belong to a canteen (ADR 008): two at Main, one at Juice Corner.
  await db.query(
    `insert into public.delivery_partners (profile_id, canteen_id, is_approved, is_online)
     values ($1, $4, true, true), ($2, $4, true, true), ($3, $5, true, true)`,
    [cast.partner, cast.otherPartner, cast.juicePartner, mainCanteen, juiceCorner],
  );

  return cast;
}

/** Place an order as the currently signed-in user. */
export async function placeOrder(
  db: Db,
  opts: {
    canteen: string;
    hostel: string;
    items: { item_id: string; quantity: number }[];
    key: string;
    block?: string;
    room?: string;
    coupon?: string | null;
    method?: string;
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select public.place_order($1::uuid, $2::jsonb, $3::uuid, $4, $5, $6, $7, $8, $9) as id`,
    [
      opts.canteen,
      JSON.stringify(opts.items),
      opts.hostel,
      opts.block ?? 'A',
      opts.room ?? '214',
      opts.key,
      '',
      opts.coupon ?? null,
      opts.method ?? 'cod',
    ],
  );
  return rows[0]!.id;
}

/** Look up a seeded menu item by canteen and name. */
export async function menuItem(db: Db, canteenId: string, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from public.menu_items where canteen_id = $1 and name = $2`,
    [canteenId, name],
  );
  if (!rows[0]) throw new Error(`no menu item ${name}`);
  return rows[0].id;
}

/** Assert that a call fails with a specific AppError code from packages/shared. */
export async function expectError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = (err as Error).message;
    if (!message.startsWith(code)) {
      throw new Error(`expected error "${code}", got "${message}"`);
    }
    return;
  }
  throw new Error(`expected error "${code}", but the call succeeded`);
}
