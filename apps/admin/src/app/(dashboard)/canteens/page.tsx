import Link from 'next/link';
import { formatPaise } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { formatHours } from '@/lib/canteen-form';
import type { SearchParams } from '@/lib/order-filters';
import { setCanteenActive } from './actions';

/**
 * Every canteen, including the disabled ones.
 *
 * "Open right now" is not computed here. It is `is_within_hours(opens_at, closes_at,
 * campus_now())`, which the schema already exposes through `canteens_public` — so this
 * page reads that view alongside the table and uses it as the answer, rather than
 * porting the midnight-crossing logic into TypeScript where it could drift.
 *
 * `canteens_public` only contains active canteens, which is exactly right: a disabled
 * canteen is never open.
 */
export default async function CanteensPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const saved = typeof params.saved === 'string' ? params.saved : null;
  const created = typeof params.created === 'string' ? params.created : null;

  const supabase = await createServerSupabase();
  const [all, open] = await Promise.all([
    supabase
      .from('canteens')
      .select('id, name, opens_at, closes_at, min_order_paise, is_accepting_orders, is_active')
      .order('name'),
    supabase.from('canteens_public').select('id').eq('is_open', true),
  ]);

  const openNow = new Set((open.data ?? []).map((row) => row.id));
  const canteens = all.data ?? [];

  return (
    <>
      <section className="card">
        <div className="topbar">
          <h2>Canteens</h2>
          <Link className="button" href="/canteens/new">
            New canteen
          </Link>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="muted">Saved {saved}.</p> : null}
        {created ? (
          <p className="muted">
            Created {created}, disabled. Add its staff and menu, then enable it below.
          </p>
        ) : null}
        {all.error ? <p className="error">{all.error.message}</p> : null}
        <p className="muted">
          Disabling a canteen hides it from students immediately. Its orders, menu and staff stay
          exactly where they are.
        </p>
      </section>

      <section className="card">
        {canteens.length === 0 ? (
          <p className="muted">No canteens yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Hours</th>
                  <th>Right now</th>
                  <th className="right">Min order</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {canteens.map((canteen) => (
                  <tr key={canteen.id}>
                    <td>
                      <Link href={`/canteens/${canteen.id}`}>{canteen.name}</Link>
                    </td>
                    <td className="muted">{formatHours(canteen.opens_at, canteen.closes_at)}</td>
                    <td>
                      {!canteen.is_active ? (
                        <span className="muted">—</span>
                      ) : !canteen.is_accepting_orders ? (
                        <span className="badge bad">paused</span>
                      ) : openNow.has(canteen.id) ? (
                        <span className="badge ok">open</span>
                      ) : (
                        <span className="badge">closed</span>
                      )}
                    </td>
                    <td className="right">{formatPaise(canteen.min_order_paise)}</td>
                    <td>
                      {canteen.is_active ? (
                        <span className="badge ok">active</span>
                      ) : (
                        <span className="badge bad">disabled</span>
                      )}
                    </td>
                    <td className="right">
                      {/* A POST, not a link: disabling changes state, and a GET that
                          mutates gets fired by any prefetcher that touches the page. */}
                      <form action={setCanteenActive.bind(null, canteen.id, !canteen.is_active)}>
                        <button className="button secondary" type="submit">
                          {canteen.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </form>
                    </td>
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
