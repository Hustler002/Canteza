import Link from 'next/link';
import { formatPaise, ORDER_STATUSES } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { formatCampusDateTime, formatStatus, statusTone } from '@/lib/format';
import {
  campusDayEnd,
  campusDayStart,
  hasFilters,
  parseOrderFilters,
  searchTerm,
  type SearchParams,
} from '@/lib/order-filters';

/**
 * Every order on the platform, searchable.
 *
 * The filters live in the URL rather than in state: a filtered view is then a link
 * an admin can paste into a message, and the page stays a server component with no
 * client bundle and no second copy of the data. The form is a plain GET, so it works
 * before JavaScript arrives and needs no handler.
 *
 * The admin sees everything because `orders_read` allows it for `is_admin()` — this
 * page holds no privilege of its own.
 */

const PAGE_SIZE = 100;

// One unbroken literal: supabase-js parses this string in the type system to work out
// the row shape, and concatenating the parts would hand it `string` and lose every column.
// `orders` has two foreign keys into `profiles`, so the embed has to name the constraint.
const SELECT =
  'id, code, status, created_at, total_paise, canteen_name_snapshot, hostel_label, block, room, profiles!orders_student_id_fkey(full_name)';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = parseOrderFilters(await searchParams);
  const supabase = await createServerSupabase();

  let query = supabase
    .from('orders')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  const term = searchTerm(filters.q);
  if (term) query = query.or(term);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.canteenId) query = query.eq('canteen_id', filters.canteenId);
  if (filters.from) query = query.gte('created_at', campusDayStart(filters.from));
  // Exclusive upper bound on the *next* campus day, so the day picked is included whole.
  if (filters.to) query = query.lt('created_at', campusDayEnd(filters.to));

  // Inactive canteens stay in the filter list: their old orders are still searchable.
  const [canteens, orders] = await Promise.all([
    supabase.from('canteens').select('id, name, is_active').order('name'),
    query,
  ]);

  const rows = orders.data ?? [];

  return (
    <>
      <section className="card">
        <h2>Orders</h2>

        <form className="toolbar" method="get">
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Order code or room"
            aria-label="Search by order code or room"
          />

          <select name="status" defaultValue={filters.status ?? ''} aria-label="Status">
            <option value="">Any status</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </select>

          <select name="canteen" defaultValue={filters.canteenId ?? ''} aria-label="Canteen">
            <option value="">Any canteen</option>
            {(canteens.data ?? []).map((canteen) => (
              <option key={canteen.id} value={canteen.id}>
                {canteen.name}
                {canteen.is_active ? '' : ' (disabled)'}
              </option>
            ))}
          </select>

          <input type="date" name="from" defaultValue={filters.from ?? ''} aria-label="From date" />
          <input type="date" name="to" defaultValue={filters.to ?? ''} aria-label="To date" />

          <button className="button" type="submit">
            Filter
          </button>
          {hasFilters(filters) ? (
            <Link className="button secondary" href="/orders">
              Clear
            </Link>
          ) : null}
        </form>

        {orders.error ? <p className="error">{orders.error.message}</p> : null}

        <p className="muted">
          {rows.length === PAGE_SIZE
            ? `Showing the ${PAGE_SIZE} most recent matches — narrow the filters to see older ones.`
            : `${rows.length} order${rows.length === 1 ? '' : 's'}.`}
        </p>
      </section>

      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">No orders match these filters.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Placed</th>
                  <th>Student</th>
                  <th>Canteen</th>
                  <th>Deliver to</th>
                  <th>Status</th>
                  <th className="right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link href={`/orders/${order.id}`}>{order.code}</Link>
                    </td>
                    <td className="muted">{formatCampusDateTime(order.created_at)}</td>
                    <td>{order.profiles?.full_name || '—'}</td>
                    <td>{order.canteen_name_snapshot}</td>
                    <td className="muted">
                      {order.hostel_label} {order.block}-{order.room}
                    </td>
                    <td>
                      <span className={`badge ${statusTone(order.status)}`.trim()}>
                        {formatStatus(order.status)}
                      </span>
                    </td>
                    <td className="right">{formatPaise(order.total_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
