import type { CampusClient } from '@canteza/api';
import { attachStaff, detachStaff } from './actions';

/**
 * Who works this counter.
 *
 * A `canteen_staff` row is what `my_canteen_id()` reads, so this list is the literal
 * answer to "whose account can see this canteen's orders" — not a label beside one.
 *
 * The picker offers students and existing canteen staff, never admins: attaching sets
 * `role = 'canteen'`, and while the RPC refuses to demote an admin, offering the choice
 * would imply it does something. Delivery partners are absent for a harder reason —
 * `transition_order` would resolve them as canteen on their own canteen's orders and
 * strand any delivery they claimed — and the RPC refuses that combination outright.
 */

/** Enough people for one campus. A search box lands when a roster outgrows a select. */
const CANDIDATE_LIMIT = 200;

export async function StaffSection({
  supabase,
  canteenId,
}: {
  supabase: CampusClient;
  canteenId: string;
}) {
  const [staff, candidates] = await Promise.all([
    supabase
      .from('canteen_staff')
      .select('profile_id, created_at, profiles(full_name, phone)')
      .eq('canteen_id', canteenId),
    supabase
      .from('profiles')
      .select('id, full_name, phone, role')
      .in('role', ['student', 'canteen'])
      .eq('is_active', true)
      .order('full_name')
      .limit(CANDIDATE_LIMIT),
  ]);

  const attached = new Set((staff.data ?? []).map((row) => row.profile_id));
  const pickable = (candidates.data ?? []).filter((person) => !attached.has(person.id));

  return (
    <section className="card">
      <h3>Staff</h3>
      <p className="muted">
        An account attached here can see and move this canteen&rsquo;s orders. Attaching someone
        moves them off any other counter they were on — one person works one canteen.
      </p>

      {(staff.data ?? []).length === 0 ? (
        <p className="muted">Nobody is on this counter yet, so no account can accept its orders.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <tbody>
              {(staff.data ?? []).map((row) => (
                <tr key={row.profile_id}>
                  <td>{row.profiles?.full_name || 'Unnamed account'}</td>
                  <td className="muted">{row.profiles?.phone ?? '—'}</td>
                  <td className="right">
                    <form action={detachStaff.bind(null, canteenId, row.profile_id)}>
                      <button className="button secondary" type="submit">
                        Detach
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pickable.length === 0 ? (
        <p className="muted">No other accounts are available to attach.</p>
      ) : (
        <form className="toolbar" action={attachStaff.bind(null, canteenId)}>
          <select name="profile_id" aria-label="Account to attach" defaultValue="">
            <option value="" disabled>
              Choose an account…
            </option>
            {pickable.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name || 'Unnamed account'}
                {person.phone ? ` · ${person.phone}` : ''}
                {person.role === 'canteen' ? ' · already on another counter' : ''}
              </option>
            ))}
          </select>
          <button className="button" type="submit">
            Attach
          </button>
        </form>
      )}
    </section>
  );
}
