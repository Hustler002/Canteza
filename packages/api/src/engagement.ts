import type { Insert, Row, Update } from '@canteza/shared';
import type { CampusClient } from './client';
import { mapSupabaseError, unwrap, unwrapList, unwrapRequired } from './errors';

/**
 * The things that happen around an order rather than to it: ratings, favourites,
 * coupons and complaints.
 *
 * Every one of these is a plain table write. None of them withholds a column, and
 * each carries a policy that already says exactly who may write what — most
 * strictly `reviews_insert_own`, which checks in SQL that the order is the writer's
 * own *and* delivered *and* from the canteen being rated. A `security definer`
 * function would restate that in a second place and could drift from it.
 *
 * `student_id` is passed in rather than read from the session here, because these
 * functions take a client and no session. Passing the wrong one does not get you
 * anywhere: every policy compares it against `auth.uid()`.
 */

/** Postgres unique_violation: the row is already there, which is what was wanted. */
const UNIQUE_VIOLATION = '23505';

export type Review = Row<'reviews'>;
export type Coupon = Row<'coupons'>;
export type SupportTicket = Row<'support_tickets'>;
export type FavoriteWithItem = Row<'favorites'> & {
  menu_items: Pick<Row<'menu_items'>, 'id' | 'name' | 'price_paise' | 'canteen_id'> | null;
};

/* ------------------------------------------------------------------- reviews */

/** The one review an order may have — `reviews.order_id` is unique. */
export async function getOrderReview(
  client: CampusClient,
  orderId: string,
): Promise<Review | null> {
  return unwrap(client.from('reviews').select('*').eq('order_id', orderId).maybeSingle());
}

export async function createReview(
  client: CampusClient,
  review: Insert<'reviews'>,
): Promise<Review> {
  return unwrapRequired(client.from('reviews').insert(review).select('*').maybeSingle(), 'review');
}

/** What a canteen has been rated, newest first. Readable by anyone signed in. */
export async function listCanteenReviews(
  client: CampusClient,
  canteenId: string,
  limit = 20,
): Promise<Review[]> {
  return unwrapList(
    client
      .from('reviews')
      .select('*')
      .eq('canteen_id', canteenId)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

/* ----------------------------------------------------------------- favourites */

/**
 * A student's favourite dishes, with enough of the dish to show and to tap through.
 *
 * Only dishes still on a menu are returned: `favorites` cascades on a deleted item,
 * but a *retired* one stays, and offering a student a dish the canteen has taken off
 * would be a dead end.
 */
export async function listFavorites(client: CampusClient): Promise<FavoriteWithItem[]> {
  return unwrapList(
    client
      .from('favorites')
      .select('*, menu_items!inner(id, name, price_paise, canteen_id)')
      .eq('menu_items.is_active', true)
      .order('created_at', { ascending: false }),
  ) as Promise<FavoriteWithItem[]>;
}

/**
 * A plain insert, deliberately not an upsert.
 *
 * `favorites` is granted `select, insert, delete` and no UPDATE, because the table is
 * nothing but its primary key — there is no column a second favourite could change.
 * PostgREST's upsert is `insert ... on conflict do update`, which asks for the UPDATE
 * privilege and is refused outright with 42501. So a repeat is a duplicate key, and a
 * duplicate key means the dish is already a favourite, which is the outcome asked for.
 */
export async function addFavorite(
  client: CampusClient,
  studentId: string,
  menuItemId: string,
): Promise<void> {
  const { error } = await client
    .from('favorites')
    .insert({ student_id: studentId, menu_item_id: menuItemId });
  if (error && error.code !== UNIQUE_VIOLATION) throw mapSupabaseError(error);
}

export async function removeFavorite(
  client: CampusClient,
  studentId: string,
  menuItemId: string,
): Promise<void> {
  await unwrap(
    client
      .from('favorites')
      .delete()
      .eq('student_id', studentId)
      .eq('menu_item_id', menuItemId)
      .select('menu_item_id')
      .maybeSingle(),
  );
}

/* -------------------------------------------------------------------- coupons */

/**
 * The codes a student may actually use right now.
 *
 * `coupons_read` already hides inactive and out-of-window codes from everyone but an
 * admin, so this is the whole usable list rather than a filtered view of a longer one.
 * It is display only: `place_order` re-reads the coupon and decides, and it is the one
 * that counts the redemptions (rule 4).
 */
export async function listCoupons(client: CampusClient): Promise<Coupon[]> {
  return unwrapList(client.from('coupons').select('*').order('min_order_paise'));
}

/* ------------------------------------------------------------------- support */

export async function createTicket(
  client: CampusClient,
  ticket: Insert<'support_tickets'>,
): Promise<SupportTicket> {
  return unwrapRequired(
    client.from('support_tickets').insert(ticket).select('*').maybeSingle(),
    'support ticket',
  );
}

/**
 * Tickets the caller may see: their own, or the platform's if they are an admin.
 * `support_tickets_own` decides which, so there is no branch here.
 */
export async function listTickets(
  client: CampusClient,
  status?: string,
  limit = 100,
): Promise<SupportTicket[]> {
  const query = client
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return unwrapList(status ? query.eq('status', status) : query);
}

/** Admin only, by policy: `support_tickets_admin` is the sole UPDATE path. */
export async function updateTicket(
  client: CampusClient,
  ticketId: string,
  patch: Update<'support_tickets'>,
): Promise<SupportTicket> {
  return unwrapRequired(
    client.from('support_tickets').update(patch).eq('id', ticketId).select('*').maybeSingle(),
    'support ticket',
  );
}
