import { isRole, type Role } from '@canteza/shared';
import type { SearchParams } from './order-filters';

/**
 * The students page's URL, and the hostel form's one awkward field.
 *
 * Unlike the orders search, the name filter here goes through `.ilike()` — a normal
 * parameterised filter on one column — rather than being interpolated into a PostgREST
 * `or=(...)` expression. That removes the injection surface entirely, at the cost of not
 * searching the phone column in the same query. Worth it: a name is what an admin has.
 */

export type PeopleFilters = {
  /** Matched against `full_name` with ilike. Wildcards are stripped, not escaped. */
  q: string;
  role: Role | null;
  /** null means "either"; true/false narrow to live or suspended accounts. */
  active: boolean | null;
};

/**
 * `%` and `_` are ilike wildcards and `*` is PostgREST's spelling of `%`. An admin
 * typing one means the character, not "match anything", so they are dropped — a name
 * never contains them. Spaces survive, which is the point of not using `or=(...)`.
 */
const WILDCARDS = /[%_*]/g;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function parsePeopleFilters(params: SearchParams): PeopleFilters {
  const role = first(params.role);
  const active = first(params.active);

  return {
    q: first(params.q).replace(WILDCARDS, '').trim().slice(0, 60),
    role: isRole(role) ? role : null,
    active: active === 'yes' ? true : active === 'no' ? false : null,
  };
}

export function hasPeopleFilters(filters: PeopleFilters): boolean {
  return Boolean(filters.q || filters.role || filters.active !== null);
}

/**
 * A hostel's blocks, typed as "A, B, C".
 *
 * Stored as `text[]`, so the form has to round-trip through something a person can type.
 * Empties are dropped rather than stored, because a trailing comma is a typo and a `''`
 * block would show up in checkout as a nameless choice.
 */
export function parseBlocks(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.split(',')) {
    const block = part.trim();
    if (block) seen.add(block);
  }
  return [...seen];
}

export function formatBlocks(blocks: readonly string[]): string {
  return blocks.join(', ');
}
