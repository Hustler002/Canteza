import Link from 'next/link';
import { formatPaise, type Row } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { campusToday, parseOrderFilters, shiftDays, type SearchParams } from '@/lib/order-filters';

/**
 * What the platform earned, and what each canteen did.
 *
 * Every figure comes from `revenue_by_canteen_day`, which sums delivered orders in
 * Postgres. The page adds up days within the chosen range; it never sees an order row,
 * so the read stays bounded by canteens × days however long the platform runs.
 *
 * The discount column is reported, never netted into anyone's revenue. `Canteen received`
 * is the money that actually reaches a canteen today, which is after the discount because
 * that is what the student paid — who *should* fund a discount is still open (ADR 008).
 * Saying both is the only honest thing until it is decided.
 */

/** A month is the range that answers "how are we doing" without needing a decision. */
const DEFAULT_DAYS = 30;

/**
 * Every column of a view is nullable in the generated types: Postgres cannot prove
 * non-nullness through a GROUP BY, so it does not claim to. Casting that away would be
 * asserting something the database never promised, so the nulls are handled instead —
 * `?? 0` for the sums, which are only null if a group somehow had no rows, and a skip
 * for a row with no canteen, which cannot happen through the join but is not worth a
 * lie to rule out.
 */
type DayRow = Row<'revenue_by_canteen_day'>;

type Totals = {
  orders: number;
  gross: number;
  discounts: number;
  delivery: number;
  platform: number;
  canteen: number;
  paid: number;
};

const ZERO: Totals = {
  orders: 0,
  gross: 0,
  discounts: 0,
  delivery: 0,
  platform: 0,
  canteen: 0,
  paid: 0,
};

function add(into: Totals, row: DayRow): Totals {
  return {
    orders: into.orders + (row.orders ?? 0),
    gross: into.gross + (row.gross_subtotal_paise ?? 0),
    discounts: into.discounts + (row.discounts_paise ?? 0),
    delivery: into.delivery + (row.delivery_fees_paise ?? 0),
    platform: into.platform + (row.platform_fee_paise ?? 0),
    canteen: into.canteen + (row.canteen_received_paise ?? 0),
    paid: into.paid + (row.students_paid_paise ?? 0),
  };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Reuses the orders page's date parsing, which already rejects anything that is not
  // yyyy-mm-dd rather than handing it to Postgres.
  const { from: parsedFrom, to: parsedTo } = parseOrderFilters(params);

  const to = parsedTo ?? campusToday();
  const from = parsedFrom ?? shiftDays(to, -(DEFAULT_DAYS - 1));

  const supabase = await createServerSupabase();
  // `day` is already a campus date in the view, so these bounds are plain and inclusive
  // — no timezone arithmetic needed here, unlike a filter on `created_at`.
  const { data, error } = await supabase
    .from('revenue_by_canteen_day')
    .select('*')
    .gte('day', from)
    .lte('day', to)
    .order('day', { ascending: false });

  const rows = data ?? [];

  const total = rows.reduce(add, ZERO);
  const perCanteen = new Map<string, { name: string; totals: Totals }>();
  for (const row of rows) {
    if (!row.canteen_id) continue;
    const entry = perCanteen.get(row.canteen_id) ?? {
      name: row.canteen_name ?? 'Unnamed canteen',
      totals: ZERO,
    };
    perCanteen.set(row.canteen_id, { name: entry.name, totals: add(entry.totals, row) });
  }
  const canteens = [...perCanteen.entries()].sort(
    (a, b) => b[1].totals.canteen - a[1].totals.canteen,
  );

  const headline: Array<{ label: string; value: string; note?: string }> = [
    { label: 'Delivered orders', value: String(total.orders) },
    { label: 'Students paid', value: formatPaise(total.paid) },
    { label: 'Platform revenue', value: formatPaise(total.platform), note: 'our cut only' },
    { label: 'Canteens received', value: formatPaise(total.canteen) },
    { label: 'Discounts given', value: formatPaise(total.discounts) },
  ];

  return (
    <>
      <section className="card">
        <h2>Analytics</h2>
        {error ? <p className="error">{error.message}</p> : null}

        <form className="toolbar" method="get">
          <input type="date" name="from" defaultValue={from} aria-label="From date" />
          <input type="date" name="to" defaultValue={to} aria-label="To date" />
          <button className="button" type="submit">
            Apply
          </button>
          <Link className="button secondary" href="/analytics">
            Last {DEFAULT_DAYS} days
          </Link>
        </form>

        <p className="muted">
          Delivered orders only, from {from} to {to} on campus time. A cancelled or rejected order
          consumes nothing and is not counted.
        </p>
      </section>

      <section className="grid">
        {headline.map((stat) => (
          <div className="card" key={stat.label}>
            <span className="muted">{stat.label}</span>
            <span className="stat">{stat.value}</span>
            {stat.note ? <span className="muted">{stat.note}</span> : null}
          </div>
        ))}
      </section>

      <section className="card">
        <h3>By canteen</h3>
        {canteens.length === 0 ? (
          <p className="muted">Nothing was delivered in this range.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Canteen</th>
                  <th className="right">Orders</th>
                  <th className="right">Food</th>
                  <th className="right">Discounts</th>
                  <th className="right">Delivery</th>
                  <th className="right">Our fee</th>
                  <th className="right">Received</th>
                </tr>
              </thead>
              <tbody>
                {canteens.map(([id, { name, totals }]) => (
                  <tr key={id}>
                    <td>
                      <Link href={`/canteens/${id}`}>{name}</Link>
                    </td>
                    <td className="right">{totals.orders}</td>
                    <td className="right">{formatPaise(totals.gross)}</td>
                    <td className="right muted">
                      {totals.discounts > 0 ? `−${formatPaise(totals.discounts)}` : '—'}
                    </td>
                    <td className="right muted">{formatPaise(totals.delivery)}</td>
                    <td className="right muted">{formatPaise(totals.platform)}</td>
                    <td className="right">{formatPaise(totals.canteen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>How to read this</h3>
        <p className="muted">
          <strong>Food</strong> is what the items listed at, before any coupon.{' '}
          <strong>Received</strong> is what actually reached the canteen: everything the student
          paid, less our fee. We take ₹2 of the ₹10 delivery fee and nothing on food.
        </p>
        <p className="muted">
          A <strong>discount</strong> comes out of the canteen&rsquo;s share, <em>including</em> a
          code an admin issued &mdash; our fee is a slice of the delivery fee and a coupon never
          touches it (ADR 008). It is shown as its own figure because it is the canteen&rsquo;s
          marketing spend, not a cost of selling the food.
        </p>
      </section>
    </>
  );
}
