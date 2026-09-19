import type { CampusClient } from '@canteza/api';
import { onboardPartner, setPartnerActive } from './actions';

/**
 * Who delivers for this canteen.
 *
 * Canteen-scoped by design (ADR 008): a partner belongs to one canteen and a composite
 * foreign key on `orders` makes a cross-canteen assignment unrepresentable. Onboarding
 * someone who already delivers elsewhere therefore *moves* them, and their old posting
 * stays on the table, retired, so the orders they carried still resolve.
 *
 * Retired postings are listed rather than hidden — restoring one is a click, and a
 * roster that silently forgets everyone who ever left is harder to trust.
 *
 * Shift is not shown as something an admin can change. `is_online` is the partner's own
 * toggle, the one column on this table a client may write, and going off shift never
 * strands an order already in hand.
 */

const CANDIDATE_LIMIT = 200;

export async function DeliverySection({
  supabase,
  canteenId,
}: {
  supabase: CampusClient;
  canteenId: string;
}) {
  const [postings, candidates, counterStaff] = await Promise.all([
    supabase
      .from('delivery_partners')
      .select('profile_id, is_approved, is_active, is_online, profiles(full_name, phone)')
      .eq('canteen_id', canteenId),
    supabase
      .from('profiles')
      .select('id, full_name, phone, role')
      .in('role', ['student', 'delivery'])
      .eq('is_active', true)
      .order('full_name')
      .limit(CANDIDATE_LIMIT),
    // `admin_set_partner_canteen` refuses anyone holding a counter posting, so offering
    // them here would only produce an error the admin could have been spared.
    supabase.from('canteen_staff').select('profile_id'),
  ]);

  const rows = postings.data ?? [];
  const here = new Set(rows.filter((row) => row.is_active).map((row) => row.profile_id));
  const onACounter = new Set((counterStaff.data ?? []).map((row) => row.profile_id));
  const pickable = (candidates.data ?? []).filter(
    (person) => !here.has(person.id) && !onACounter.has(person.id),
  );

  return (
    <section className="card">
      <h3>Delivery staff</h3>
      <p className="muted">
        A partner carries only this canteen&rsquo;s orders. Onboarding someone who delivers
        elsewhere moves them here and retires the old posting, which is kept so the orders they
        carried still resolve.
      </p>

      {rows.length === 0 ? (
        <p className="muted">
          Nobody delivers for this canteen yet. Until someone does, the counter marks its own orders
          delivered.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <tbody>
              {rows.map((row) => (
                <tr key={row.profile_id}>
                  <td>{row.profiles?.full_name || 'Unnamed account'}</td>
                  <td className="muted">{row.profiles?.phone ?? '—'}</td>
                  <td>
                    {!row.is_active ? (
                      <span className="badge bad">retired</span>
                    ) : !row.is_approved ? (
                      // my_delivery_canteen_id() requires the flag, so this partner sees
                      // no queue at all — worth showing rather than leaving as a puzzle.
                      <span className="badge bad">not approved</span>
                    ) : row.is_online ? (
                      <span className="badge ok">on shift</span>
                    ) : (
                      <span className="badge">off shift</span>
                    )}
                  </td>
                  <td className="right">
                    <form
                      action={setPartnerActive.bind(
                        null,
                        canteenId,
                        row.profile_id,
                        !row.is_active,
                      )}
                    >
                      <button className="button secondary" type="submit">
                        {row.is_active ? 'Retire' : 'Restore'}
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
        <p className="muted">No other accounts are available to onboard.</p>
      ) : (
        <form className="toolbar" action={onboardPartner.bind(null, canteenId)}>
          <select name="profile_id" aria-label="Account to onboard" defaultValue="">
            <option value="" disabled>
              Choose an account…
            </option>
            {pickable.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name || 'Unnamed account'}
                {person.phone ? ` · ${person.phone}` : ''}
                {person.role === 'delivery' ? ' · already delivering elsewhere' : ''}
              </option>
            ))}
          </select>
          <button className="button" type="submit">
            Onboard
          </button>
        </form>
      )}

      <p className="muted">
        A new posting starts <strong>off shift</strong> — going online is the partner&rsquo;s own
        switch, not an admin&rsquo;s.
      </p>
    </section>
  );
}
