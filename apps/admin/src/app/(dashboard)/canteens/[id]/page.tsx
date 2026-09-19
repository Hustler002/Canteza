import Link from 'next/link';
import { notFound } from 'next/navigation';
import { paiseToRupees } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SearchParams } from '@/lib/order-filters';
import { updateCanteen } from '../actions';

/**
 * Edit one canteen.
 *
 * A plain form that posts to a server action — no client component, no controlled
 * inputs. The whole record is submitted on every save, which is what lets the RPC
 * assign rather than merge, and is why clearing the phone field actually clears it.
 *
 * `is_active` is deliberately not here: enabling and disabling is the list's job, so
 * that a half-finished edit cannot take a canteen off the campus by accident.
 */
export default async function CanteenEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const error = typeof query.error === 'string' ? query.error : null;

  const supabase = await createServerSupabase();
  const { data: canteen } = await supabase.from('canteens').select('*').eq('id', id).maybeSingle();

  if (!canteen) notFound();

  return (
    <>
      <section className="card">
        <Link className="muted" href="/canteens">
          ← All canteens
        </Link>
        <div className="topbar">
          <h2>{canteen.name}</h2>
          {canteen.is_active ? (
            <span className="badge ok">active</span>
          ) : (
            <span className="badge bad">disabled</span>
          )}
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card">
        <form className="stack" action={updateCanteen.bind(null, id)}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" defaultValue={canteen.name} maxLength={80} required />
            <span className="muted">
              Past orders keep the name they were placed under, so renaming does not rewrite any
              receipt.
            </span>
          </div>

          <div className="field">
            <label htmlFor="description">Description</label>
            <input id="description" name="description" defaultValue={canteen.description} />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="opens_at">Opens</label>
              <input
                id="opens_at"
                name="opens_at"
                type="time"
                defaultValue={canteen.opens_at.slice(0, 5)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="closes_at">Closes</label>
              <input
                id="closes_at"
                name="closes_at"
                type="time"
                defaultValue={canteen.closes_at.slice(0, 5)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="min_order_rupees">Minimum order (₹)</label>
              <input
                id="min_order_rupees"
                name="min_order_rupees"
                type="number"
                min="0"
                step="1"
                defaultValue={paiseToRupees(canteen.min_order_paise)}
              />
            </div>
          </div>

          <p className="muted">
            A closing time earlier than the opening time is a window that crosses midnight — Night
            Canteen runs 20:00 to 02:00. Setting both to the same time means open around the clock.
          </p>

          <div className="row">
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" defaultValue={canteen.phone ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="image_url">Image URL</label>
              <input id="image_url" name="image_url" defaultValue={canteen.image_url ?? ''} />
            </div>
          </div>

          <label className="check">
            <input
              type="checkbox"
              name="is_accepting_orders"
              defaultChecked={canteen.is_accepting_orders}
            />
            <span>
              Accepting orders
              <span className="muted">
                {' '}
                — the counter&rsquo;s own pause switch, separate from the hours above.
              </span>
            </span>
          </label>

          <div className="toolbar">
            <button className="button" type="submit">
              Save
            </button>
            <Link className="button secondary" href="/canteens">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </>
  );
}
