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
export type CanteenStats = Row<'canteen_stats'>;
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

/**
 * Rating and kitchen-speed stats for every active canteen.
 *
 * A separate read from `listCanteens` rather than extra columns on `canteens_public`,
 * because the two have completely different shelf lives: whether a canteen is open
 * changes at a minute boundary, while a 30-day median moves imperceptibly. Joined
 * into one view, the cheap query would inherit the expensive one's cost on every
 * home-screen load. Split, the stats cache for minutes (see `useCanteenStats`) and
 * the open/closed state stays live.
 */
export async function listCanteenStats(client: CampusClient): Promise<CanteenStats[]> {
  return unwrapList(client.from('canteen_stats').select('*'));
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

/**
 * Dish search across every canteen.
 *
 * `menu_items_read` already lets any signed-in student read any active item, so this
 * needs no new policy and no view -- it is the search the home screen never had, not
 * a change to how the data is protected.
 *
 * The term goes through `.ilike()` as a bound parameter rather than into a PostgREST
 * `or=(...)` string, so unlike the admin's order search there is no expression for a
 * comma to break out of.
 *
 * The user's own wildcards are **stripped, not escaped**. Backslash-escaping them is
 * the obvious move and it does not work: checked against the live project, `ilike`
 * with `%Mag\%i%` returns exactly what `%Mag%i%` returns, so PostgREST does not pass
 * the backslash through as an ESCAPE. Since `%` and `_` are not characters anyone
 * searches a menu for, dropping them is both honest and harmless -- where leaving
 * them in means a two-character search for `%a` quietly matches the whole menu.
 *
 * Sold-out dishes are included for the same reason `listMenu` returns them: someone
 * searching "Maggi" wants to know it exists and is finished, not to conclude the
 * canteen never sold it.
 */
export async function searchMenuItems(
  client: CampusClient,
  term: string,
  limit = 25,
): Promise<MenuItem[]> {
  const cleaned = term.trim().replace(/[%_\\]/g, '');
  if (cleaned.length < 2) return [];

  const pattern = `%${cleaned}%`;

  return unwrapList(
    client
      .from('menu_items')
      .select('*')
      .eq('is_active', true)
      .ilike('name', pattern)
      .order('name')
      .limit(limit),
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
