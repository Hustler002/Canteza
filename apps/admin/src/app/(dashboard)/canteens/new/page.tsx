import Link from 'next/link';
import type { SearchParams } from '@/lib/order-filters';
import { createCanteen } from '../actions';
import { CanteenFields } from '../canteen-fields';

/**
 * A new canteen.
 *
 * It is created disabled, and the copy says so rather than leaving the admin to notice
 * the badge: a canteen with no menu and no staff should not be on a student's list, so
 * turning it on is a deliberate second step once both exist.
 */
export default async function NewCanteenPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const error = typeof query.error === 'string' ? query.error : null;

  return (
    <>
      <section className="card">
        <Link className="muted" href="/canteens">
          ← All canteens
        </Link>
        <h2>New canteen</h2>
        <p className="muted">
          It starts disabled, so students will not see it yet. Add its staff account and its menu
          first, then enable it from the list.
        </p>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card">
        <form className="stack" action={createCanteen}>
          <CanteenFields canteen={null} />
          <div className="toolbar">
            <button className="button" type="submit">
              Create
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
