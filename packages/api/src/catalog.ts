import type { Insert, Row, Update } from '@canteza/shared';
import type { CampusClient } from './client';
import { unwrap, unwrapList, unwrapRequired } from './errors';

/**
 * Browsing data: canteens, menus, hostels.
 *
 * Reads go straight to PostgREST and are filtered by RLS, so there is no ownership
 * check to write here — a query cannot return a row the caller may not see.
 */

export type Canteen = Row<'canteens_public'>;
export type MenuItem = Row<'menu_items'>;
export type Category = Row<'food_categories'>;
export type Hostel = Row<'hostels'>;

/**
 * `canteens_public` derives `is_open` from opening hours at query time, so a canteen
 * that shut at 22:00 reports itself shut without anyone remembering to flip a flag.
 */
export async function listCanteens(client: CampusClient): Promise<Canteen[]> {
  return unwrapList(client.from('canteens_public').select('*').order('name'));
}

export async function getCanteen(client: CampusClient, canteenId: string): Promise<Canteen | null> {
  return unwrap(client.from('canteens_public').select('*').eq('id', canteenId).maybeSingle());
}

/**
 * Unavailable items are returned rather than filtered out: a student looking for
 * Maggi should see it greyed out as sold out, not silently absent.
 */
export async function listMenu(client: CampusClient, canteenId: string): Promise<MenuItem[]> {
  return unwrapList(
    client
      .from('menu_items')
      .select('*')
      .eq('canteen_id', canteenId)
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
  );
}

export async function listCategories(client: CampusClient): Promise<Category[]> {
  return unwrapList(client.from('food_categories').select('*').order('sort_order'));
}

/* ------------------------------------------------------- the counter's own menu */

/**
 * Every item this canteen has, retired ones included.
 *
 * The difference from `listMenu` is what a counter needs and a student must not get:
 * `is_active = false` rows, so someone can bring a dish back. `menu_items_read`
 * already scopes that to the caller's own canteen (or an admin), so this returns
 * nothing extra to anyone else — the filter here is for ordering, not for safety.
 */
export async function listCanteenMenu(
  client: CampusClient,
  canteenId: string,
): Promise<MenuItem[]> {
  return unwrapList(
    client
      .from('menu_items')
      .select('*')
      .eq('canteen_id', canteenId)
      .order('is_active', { ascending: false })
      .order('sort_order')
      .order('name'),
  );
}

/**
 * Menu writes.
 *
 * Plain table writes, not an RPC: `menu_items` withholds no column, and
 * `menu_items_own_canteen` carries the WITH CHECK that ties every row to
 * `my_canteen_id()`. A counter cannot write another canteen's item however it asks,
 * and `canteen_id` here is the caller's own — the policy, not this argument, is what
 * makes that true.
 */
export async function createMenuItem(
  client: CampusClient,
  item: Insert<'menu_items'>,
): Promise<MenuItem> {
  return unwrapRequired(
    client.from('menu_items').insert(item).select('*').maybeSingle(),
    'menu item',
  );
}

/** Used for a price edit, the sold-out switch, and retiring — one patch, three callers. */
export async function updateMenuItem(
  client: CampusClient,
  itemId: string,
  patch: Update<'menu_items'>,
): Promise<MenuItem> {
  return unwrapRequired(
    client.from('menu_items').update(patch).eq('id', itemId).select('*').maybeSingle(),
    'menu item',
  );
}

export async function listHostels(client: CampusClient): Promise<Hostel[]> {
  return unwrapList(client.from('hostels').select('*').eq('is_active', true).order('name'));
}

export type DefaultAddress = {
  hostelId: string;
  block: string;
  room: string;
};

/**
 * The student's usual address. Only these three columns have an UPDATE grant on
 * profiles, so this cannot be used to touch `role`.
 */
export async function saveDefaultAddress(
  client: CampusClient,
  userId: string,
  address: DefaultAddress,
): Promise<void> {
  await unwrap(
    client
      .from('profiles')
      .update({
        default_hostel_id: address.hostelId,
        default_block: address.block,
        default_room: address.room.trim(),
      })
      .eq('id', userId)
      .select('id'),
  );
}

export function readDefaultAddress(profile: Row<'profiles'>): DefaultAddress | null {
  // The CHECK constraint keeps these three all-set or all-null, so testing one is
  // enough — but narrowing all three is what convinces TypeScript.
  if (!profile.default_hostel_id || !profile.default_block || !profile.default_room) return null;
  return {
    hostelId: profile.default_hostel_id,
    block: profile.default_block,
    room: profile.default_room,
  };
}
