#!/usr/bin/env node
/**
 * Generates packages/shared/src/database.types.ts from supabase/migrations/.
 *
 * Why not `supabase gen types`: that command shells out to Docker even when given
 * --db-url, and this project deliberately runs without Docker (ADR 007). So the
 * migrations are applied to PGlite -- real Postgres -- and the types are emitted from
 * its own catalogs. Same source of truth, no daemon.
 *
 *   npm run db:types
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const OUT = join(ROOT, 'packages/shared/src/database.types.ts');

const AUTH_SHIM = `
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'
  );
  create or replace function auth.uid() returns uuid language sql stable as $shim$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $shim$;
  create role anon;
  create role authenticated;
  create role service_role;
`;

/** Postgres type -> TypeScript. Anything unmapped becomes `unknown`, loudly. */
function tsType(dataType, udtName) {
  // format_type() renders arrays as `text[]`, and pg_type names them `_text`.
  if (udtName?.startsWith('_') || dataType?.endsWith('[]')) {
    return `${tsType('', udtName.replace(/^_/, ''))}[]`;
  }
  switch (udtName) {
    case 'uuid':
    case 'text':
    case 'varchar':
    case 'bpchar':
    case 'timestamptz':
    case 'timestamp':
    case 'date':
    case 'time':
    case 'timetz':
    case 'interval':
      return 'string';
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
      return 'number';
    case 'bool':
      return 'boolean';
    case 'json':
    case 'jsonb':
      return 'Json';
    case 'void':
      return 'undefined';
    default:
      return 'unknown';
  }
}

const db = await PGlite.create();
await db.exec(AUTH_SHIM);
for (const file of readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
}

const { rows: columns } = await db.query(`
  select c.relname                             as rel,
         c.relkind                             as kind,
         a.attname                             as col,
         format_type(a.atttypid, a.atttypmod)  as data_type,
         t.typname                             as udt,
         not a.attnotnull                      as nullable,
         (d.adbin is not null or a.attidentity <> '') as has_default,
         a.attgenerated <> ''                  as generated
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
     and c.relkind in ('r', 'v')
   order by c.relname, a.attnum
`);

const { rows: fks } = await db.query(`
  select con.conname as name,
         rel.relname  as rel,
         fre.relname  as ref_rel,
         (select array_agg(att.attname order by k.ord)
            from unnest(con.conkey) with ordinality k(attnum, ord)
            join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum) as cols,
         (select array_agg(att.attname order by k.ord)
            from unnest(con.confkey) with ordinality k(attnum, ord)
            join pg_attribute att on att.attrelid = con.confrelid and att.attnum = k.attnum) as ref_cols
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_class fre on fre.oid = con.confrelid
    join pg_namespace n on n.oid = rel.relnamespace
   where con.contype = 'f' and n.nspname = 'public'
   order by rel.relname, con.conname
`);

const { rows: fns } = await db.query(`
  select p.proname                                as name,
         coalesce(p.proargnames, '{}')            as argnames,
         -- WITH ORDINALITY + ORDER BY is load-bearing: joining pg_type to a bare
         -- unnest() does not preserve argument order, which silently shifted every
         -- function's argument types against its argument names.
         array(select t.typname
                 from unnest(p.proargtypes) with ordinality as a(oid, ord)
                 join pg_type t on t.oid = a.oid
                order by a.ord)                   as argtypes,
         array(select format_type(a.oid, null)
                 from unnest(p.proargtypes) with ordinality as a(oid, ord)
                order by a.ord)                   as argfmt,
         p.pronargdefaults                        as ndefaults,
         (select typname from pg_type where oid = p.prorettype) as rettype,
         format_type(p.prorettype, null)          as retfmt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and format_type(p.prorettype, null) <> 'trigger'
   order by p.proname
`);

const byRel = new Map();
for (const c of columns) {
  if (!byRel.has(c.rel)) byRel.set(c.rel, { kind: c.kind, cols: [] });
  byRel.get(c.rel).cols.push(c);
}

const relationships = new Map();
for (const fk of fks) {
  if (!relationships.has(fk.rel)) relationships.set(fk.rel, []);
  relationships.get(fk.rel).push(fk);
}

const indent = (n) => '  '.repeat(n);

function renderRelationships(rel, depth) {
  const list = relationships.get(rel) ?? [];
  if (list.length === 0) return `${indent(depth)}Relationships: [];`;
  const body = list
    .map(
      (fk) => `${indent(depth + 1)}{
${indent(depth + 2)}foreignKeyName: '${fk.name}';
${indent(depth + 2)}columns: [${fk.cols.map((c) => `'${c}'`).join(', ')}];
${indent(depth + 2)}isOneToOne: false;
${indent(depth + 2)}referencedRelation: '${fk.ref_rel}';
${indent(depth + 2)}referencedColumns: [${fk.ref_cols.map((c) => `'${c}'`).join(', ')}];
${indent(depth + 1)}}`,
    )
    .join(',\n');
  return `${indent(depth)}Relationships: [\n${body},\n${indent(depth)}];`;
}

function renderRelation(name, info) {
  const isView = info.kind === 'v';
  const row = info.cols
    .map(
      (c) => `${indent(4)}${c.col}: ${tsType(c.data_type, c.udt)}${c.nullable ? ' | null' : ''};`,
    )
    .join('\n');

  if (isView) {
    return `${indent(2)}${name}: {
${indent(3)}Row: {
${row}
${indent(3)}};
${renderRelationships(name, 3)}
${indent(2)}};`;
  }

  const insert = info.cols
    .filter((c) => !c.generated)
    .map((c) => {
      const optional = c.nullable || c.has_default;
      return `${indent(4)}${c.col}${optional ? '?' : ''}: ${tsType(c.data_type, c.udt)}${c.nullable ? ' | null' : ''};`;
    })
    .join('\n');

  const update = info.cols
    .filter((c) => !c.generated)
    .map(
      (c) => `${indent(4)}${c.col}?: ${tsType(c.data_type, c.udt)}${c.nullable ? ' | null' : ''};`,
    )
    .join('\n');

  return `${indent(2)}${name}: {
${indent(3)}Row: {
${row}
${indent(3)}};
${indent(3)}Insert: {
${insert}
${indent(3)}};
${indent(3)}Update: {
${update}
${indent(3)}};
${renderRelationships(name, 3)}
${indent(2)}};`;
}

const tables = [...byRel.entries()].filter(([, i]) => i.kind === 'r');
const views = [...byRel.entries()].filter(([, i]) => i.kind === 'v');

const functions = fns
  .map((f) => {
    const names = f.argnames ?? [];
    const required = f.argtypes.length - Number(f.ndefaults ?? 0);
    const args = f.argtypes.length
      ? f.argtypes
          .map((t, i) => {
            const argName = names[i] ?? `arg${i}`;
            const optional = i >= required ? '?' : '';
            return `${indent(4)}${argName}${optional}: ${tsType(f.argfmt[i], t)};`;
          })
          .join('\n')
      : null;
    return `${indent(2)}${f.name}: {
${indent(3)}Args: ${args ? `{\n${args}\n${indent(3)}}` : 'Record<PropertyKey, never>'};
${indent(3)}Returns: ${tsType(f.retfmt, f.rettype)};
${indent(2)}};`;
  })
  .join('\n');

const out = `// GENERATED FILE -- do not edit by hand.
// Regenerate with: npm run db:types
// Source of truth: supabase/migrations/

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
${tables.map(([n, i]) => renderRelation(n, i)).join('\n')}
    };
    Views: {
${views.map(([n, i]) => renderRelation(n, i)).join('\n')}
    };
    Functions: {
${functions}
    };
    Enums: Record<PropertyKey, never>;
    CompositeTypes: Record<PropertyKey, never>;
  };
};

type PublicSchema = Database['public'];

/** Row type of a table or view, e.g. \`Row<'orders'>\`. */
export type Row<T extends keyof (PublicSchema['Tables'] & PublicSchema['Views'])> =
  (PublicSchema['Tables'] & PublicSchema['Views'])[T] extends { Row: infer R } ? R : never;

/** Insert type of a table, e.g. \`Insert<'reviews'>\`. */
export type Insert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Insert: infer I } ? I : never;

/** Update type of a table, e.g. \`Update<'profiles'>\`. */
export type Update<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Update: infer U } ? U : never;
`;

await db.close();
writeFileSync(OUT, out);

const unknowns = (out.match(/: unknown/g) ?? []).length;
console.log(
  `wrote database.types.ts — ${tables.length} tables, ${views.length} views, ${fns.length} functions` +
    (unknowns ? `\nWARNING: ${unknowns} column(s) mapped to \`unknown\`; extend tsType()` : ''),
);
