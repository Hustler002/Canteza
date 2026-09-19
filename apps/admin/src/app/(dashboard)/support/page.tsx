import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { formatCampusDateTime } from '@/lib/format';
import type { SearchParams } from '@/lib/order-filters';
import { updateTicket } from './actions';

/**
 * The complaints queue.
 *
 * Open first, because a queue sorted by date alone buries the thing that needs doing
 * under a month of resolved tickets. Within each group it is newest first, the same
 * order every other list in this dashboard uses.
 *
 * The student who filed it is read through the `profiles` embed — this app cannot see
 * anyone's email (that lives in `auth.users`, which PostgREST does not expose), so a
 * person is a name and a phone here as everywhere else.
 */

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

/** Same ceiling as the orders and accounts pages; a cursor lands when it bites. */
const LIMIT = 100;

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const saved = typeof params.saved === 'string' ? params.saved : null;
  const status = typeof params.status === 'string' ? params.status : '';

  const supabase = await createServerSupabase();
  let query = supabase
    .from('support_tickets')
    .select('*, profiles(full_name, phone), orders(code)')
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if ((STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);

  const { data, error: readError } = await query;
  const tickets = data ?? [];
  // "Needs someone" first, whatever the date says.
  const sorted = [...tickets].sort((a, b) => rank(a.status) - rank(b.status));

  return (
    <>
      <section className="card">
        <h2>Support</h2>
        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="muted">Ticket updated.</p> : null}
        {readError ? <p className="error">{readError.message}</p> : null}
        <p className="muted">
          What students report, and what was done about it. A student can read the resolution you
          write here but cannot change a ticket&rsquo;s status &mdash; that is an admin&rsquo;s job
          by policy, not by screen.
        </p>

        <form className="toolbar" method="get">
          <select name="status" defaultValue={status} aria-label="Status">
            <option value="">Every status</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.replace('_', ' ')}
              </option>
            ))}
          </select>
          <button className="button" type="submit">
            Filter
          </button>
          {status ? (
            <Link className="button secondary" href="/support">
              Clear
            </Link>
          ) : null}
        </form>
      </section>

      {sorted.length === 0 ? (
        <section className="card">
          <p className="muted">
            Nothing here. Either the campus is happy or nobody has found the form.
          </p>
        </section>
      ) : (
        sorted.map((ticket) => (
          <section className="card" key={ticket.id}>
            <div className="topbar">
              <h3>{ticket.subject}</h3>
              <span className={`badge ${tone(ticket.status)}`}>
                {ticket.status.replace('_', ' ')}
              </span>
            </div>

            <p className="muted">
              {ticket.profiles?.full_name || 'Unnamed account'}
              {ticket.profiles?.phone ? ` · ${ticket.profiles.phone}` : ''} ·{' '}
              {formatCampusDateTime(ticket.created_at)}
              {ticket.orders?.code ? ' · ' : ''}
              {ticket.orders?.code ? (
                <Link href={`/orders?q=${encodeURIComponent(ticket.orders.code)}`}>
                  {ticket.orders.code}
                </Link>
              ) : null}
            </p>

            {ticket.body ? <p>{ticket.body}</p> : null}

            <form className="stack" action={updateTicket.bind(null, ticket.id)}>
              <div className="row">
                <div className="field">
                  <label htmlFor={`status-${ticket.id}`}>Status</label>
                  <select id={`status-${ticket.id}`} name="status" defaultValue={ticket.status}>
                    {STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {value.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`resolution-${ticket.id}`}>What was done</label>
                  <input
                    id={`resolution-${ticket.id}`}
                    name="resolution"
                    defaultValue={ticket.resolution ?? ''}
                    placeholder="Refunded in cash at the counter"
                  />
                  <span className="muted">The student reads this on their phone.</span>
                </div>
              </div>
              <div className="toolbar">
                <button className="button" type="submit">
                  Save
                </button>
              </div>
            </form>
          </section>
        ))
      )}
    </>
  );
}

/** Open work first, finished work last. */
function rank(status: string): number {
  if (status === 'open') return 0;
  if (status === 'in_progress') return 1;
  if (status === 'resolved') return 2;
  return 3;
}

function tone(status: string): string {
  if (status === 'resolved') return 'ok';
  if (status === 'open') return 'bad';
  return '';
}
