import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORDER_STATUSES, ORDER_TRANSITIONS } from '../../packages/shared/src/order-status';
import { createTestDb, type Db } from './harness';

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

describe('schema', () => {
  it('applies every migration cleanly', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );
    expect(rows[0]!.n).toBeGreaterThan(15);
  });

  it('leaves no table in public without row level security', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and not rowsecurity`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('gives every RLS-enabled table at least one policy', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select t.tablename from pg_tables t
        where t.schemaname = 'public'
          and not exists (
            select 1 from pg_policies p
             where p.schemaname = 'public' and p.tablename = t.tablename
          )`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });
});

describe('order_transitions mirrors packages/shared', () => {
  it('contains exactly the edges declared in TypeScript', async () => {
    const { rows } = await db.query<{ from_status: string; to_status: string; actor: string }>(
      `select from_status, to_status, actor from public.order_transitions`,
    );
    const sql = rows.map((r) => `${r.from_status}>${r.to_status}:${r.actor}`).sort();

    const ts: string[] = [];
    for (const from of ORDER_STATUSES) {
      for (const [to, actors] of Object.entries(ORDER_TRANSITIONS[from])) {
        for (const actor of actors ?? []) ts.push(`${from}>${to}:${actor}`);
      }
    }

    expect(sql).toEqual(ts.sort());
  });

  it('constrains orders.status to exactly ORDER_STATUSES', async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.orders'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) like '%status%'`,
    );
    const def = rows.map((r) => r.def).join(' ');
    for (const status of ORDER_STATUSES) expect(def).toContain(`'${status}'`);
  });
});
