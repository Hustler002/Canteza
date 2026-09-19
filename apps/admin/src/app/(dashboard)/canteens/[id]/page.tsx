import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SearchParams } from '@/lib/order-filters';
import { updateCanteen } from '../actions';
import { CanteenFields } from '../canteen-fields';
import { StaffSection } from '../staff-section';
import { DeliverySection } from '../delivery-section';

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
          <CanteenFields canteen={canteen} />

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

      <StaffSection supabase={supabase} canteenId={id} />
      <DeliverySection supabase={supabase} canteenId={id} />
    </>
  );
}
