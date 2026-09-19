import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrder, getOrderHistory } from '@canteza/api';
import { formatPaise } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { formatCampusDateTime, formatStatus, statusTone } from '@/lib/format';

/**
 * One order, with the trail of how it got where it is.
 *
 * The trail is `order_status_history`, which every RPC writes as it moves an order.
 * That makes this page the answer to "who cancelled it, and when" without anyone
 * having to trust a log file — the row was written in the same transaction as the move.
 *
 * Read-only on purpose. Clients hold no write grant on `orders` at all (not even
 * admins), so an admin acting on an order goes through `transition_order` like
 * everyone else. That belongs with the canteen tooling, not here.
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [order, history] = await Promise.all([
    getOrder(supabase, id),
    getOrderHistory(supabase, id),
  ]);

  // RLS makes "not yours" and "does not exist" the same empty result, which is the
  // point — but for an admin, who can read every order, it really is missing.
  if (!order) notFound();

  const peopleIds = [order.student_id, order.delivery_partner_id].filter(
    (value): value is string => value !== null,
  );
  const { data: people } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', peopleIds);

  const nameOf = (profileId: string | null): string =>
    (profileId && people?.find((person) => person.id === profileId)?.full_name) || '—';

  return (
    <>
      <section className="card">
        <Link className="muted" href="/orders">
          ← All orders
        </Link>
        <div className="topbar">
          <h2>{order.code}</h2>
          <span className={`badge ${statusTone(order.status)}`.trim()}>
            {formatStatus(order.status)}
          </span>
        </div>
        <p className="muted">Placed {formatCampusDateTime(order.created_at)}</p>
        {order.cancellation_reason ? (
          <p className="error">Reason given: {order.cancellation_reason}</p>
        ) : null}
      </section>

      <div className="grid">
        <section className="card">
          <h3>People</h3>
          <dl className="pairs">
            <dt>Student</dt>
            <dd>{nameOf(order.student_id)}</dd>
            <dt>Canteen</dt>
            <dd>{order.canteen_name_snapshot}</dd>
            <dt>Delivery</dt>
            <dd>{order.delivery_partner_id ? nameOf(order.delivery_partner_id) : 'Unassigned'}</dd>
          </dl>
        </section>

        <section className="card">
          <h3>Deliver to</h3>
          <dl className="pairs">
            <dt>Hostel</dt>
            <dd>{order.hostel_label}</dd>
            <dt>Room</dt>
            <dd>
              {order.block}-{order.room}
            </dd>
            <dt>Note</dt>
            <dd>{order.delivery_note || '—'}</dd>
          </dl>
        </section>
      </div>

      <section className="card">
        <h3>Items</h3>
        {/* Names and prices are the snapshot taken at purchase, never a join to the
            live menu — this is a receipt, not a catalogue (ADR 003). */}
        <div className="table-scroll">
          <table className="table">
            <tbody>
              {order.order_items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name_snapshot}</td>
                  <td className="muted">× {item.quantity}</td>
                  <td className="right">{formatPaise(item.line_total_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="pairs">
          <dt>Subtotal</dt>
          <dd className="right">{formatPaise(order.subtotal_paise)}</dd>
          {order.discount_paise > 0 ? (
            <>
              <dt>
                Discount {order.coupon_code_snapshot ? `(${order.coupon_code_snapshot})` : ''}
              </dt>
              <dd className="right">−{formatPaise(order.discount_paise)}</dd>
            </>
          ) : null}
          <dt>Delivery</dt>
          <dd className="right">{formatPaise(order.delivery_fee_paise)}</dd>
          <dt>
            <strong>Total</strong>
          </dt>
          <dd className="right">
            <strong>{formatPaise(order.total_paise)}</strong>
          </dd>
          {/* Our cut, not the canteen's takings: ₹2 of the ₹10 delivery fee (ADR 008). */}
          <dt className="muted">Platform fee</dt>
          <dd className="right muted">{formatPaise(order.platform_fee_paise)}</dd>
        </dl>
      </section>

      <section className="card">
        <h3>Trail</h3>
        {history.length === 0 ? (
          <p className="muted">No transitions recorded.</p>
        ) : (
          <ol className="trail">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className={`badge ${statusTone(entry.to_status)}`.trim()}>
                  {formatStatus(entry.to_status)}
                </span>
                <span className="muted">
                  {entry.from_status ? `from ${formatStatus(entry.from_status)} · ` : ''}
                  by {entry.actor} · {formatCampusDateTime(entry.created_at)}
                </span>
                {entry.reason ? <span>{entry.reason}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
