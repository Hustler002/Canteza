import Link from 'next/link';
import { getIdentity } from '@canteza/api';
import { ROLES } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { formatCampusDateTime } from '@/lib/format';
import type { SearchParams } from '@/lib/order-filters';
import { hasPeopleFilters, parsePeopleFilters } from '@/lib/people-filters';
import { setProfileActive, setProfileRole } from './actions';

/**
 * Every account on the platform.
 *
 * "Students" is what the roadmap calls it and what it mostly is, but the list is every
 * profile — a role change is how someone becomes canteen staff or a partner in the first
 * place, so filtering admins out would hide the thing the page is for.
 *
 * Names and phones are read-only here. The grant would permit writing them, but they are
 * the person's own details and they can edit them in the app; an admin quietly changing
 * someone's name is not a feature anyone asked for.
 *
 * There is no email column anywhere in this app: email lives in `auth.users`, which
 * PostgREST does not expose. People are identified by name and phone.
 */

const PAGE_SIZE = 100;

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filters = parsePeopleFilters(params);
  const error = typeof params.error === 'string' ? params.error : null;

  const supabase = await createServerSupabase();

  let query = supabase
    .from('profiles')
    .select('id, full_name, phone, role, is_active, created_at')
    .order('full_name')
    .limit(PAGE_SIZE);

  // A parameterised filter on one column — no or=(...) expression, so no injection
  // surface and a space in a name just works.
  if (filters.q) query = query.ilike('full_name', `%${filters.q}%`);
  if (filters.role) query = query.eq('role', filters.role);
  if (filters.active !== null) query = query.eq('is_active', filters.active);

  const [identity, people] = await Promise.all([getIdentity(supabase), query]);

  const rows = people.data ?? [];

  return (
    <>
      <section className="card">
        <h2>Accounts</h2>
        {error ? <p className="error">{error}</p> : null}
        {people.error ? <p className="error">{people.error.message}</p> : null}

        <form className="toolbar" method="get">
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Name"
            aria-label="Search by name"
          />
          <select name="role" defaultValue={filters.role ?? ''} aria-label="Role">
            <option value="">Any role</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <select
            name="active"
            defaultValue={filters.active === null ? '' : filters.active ? 'yes' : 'no'}
            aria-label="Account state"
          >
            <option value="">Any state</option>
            <option value="yes">Active</option>
            <option value="no">Suspended</option>
          </select>
          <button className="button" type="submit">
            Filter
          </button>
          {hasPeopleFilters(filters) ? (
            <Link className="button secondary" href="/students">
              Clear
            </Link>
          ) : null}
        </form>

        <p className="muted">
          {rows.length === PAGE_SIZE
            ? `Showing ${PAGE_SIZE} accounts — narrow the filters to see the rest.`
            : `${rows.length} account${rows.length === 1 ? '' : 's'}.`}
        </p>
      </section>

      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">No accounts match these filters.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Joined</th>
                  <th>State</th>
                  <th>Role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((person) => {
                  // An admin cannot demote or suspend themselves — the database refuses
                  // both — so the controls are not offered rather than offered and denied.
                  const isSelf = person.id === identity?.userId;
                  return (
                    <tr key={person.id}>
                      <td>{person.full_name || 'Unnamed account'}</td>
                      <td className="muted">{person.phone ?? '—'}</td>
                      <td className="muted">{formatCampusDateTime(person.created_at)}</td>
                      <td>
                        {person.is_active ? (
                          <span className="badge ok">active</span>
                        ) : (
                          <span className="badge bad">suspended</span>
                        )}
                      </td>
                      <td>
                        {isSelf ? (
                          <span className="badge">{person.role} · you</span>
                        ) : (
                          <form className="toolbar" action={setProfileRole}>
                            <input type="hidden" name="profile_id" value={person.id} />
                            <select
                              name="role"
                              defaultValue={person.role}
                              aria-label={`Role for ${person.full_name || 'this account'}`}
                            >
                              {ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                            <button className="button secondary" type="submit">
                              Set
                            </button>
                          </form>
                        )}
                      </td>
                      <td className="right">
                        {isSelf ? null : (
                          <form action={setProfileActive.bind(null, person.id, !person.is_active)}>
                            <button className="button secondary" type="submit">
                              {person.is_active ? 'Suspend' : 'Restore'}
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <p className="muted">
          Promoting someone to <strong>canteen</strong> or <strong>delivery</strong> here changes
          only which app they land in. What actually grants access is a posting — attach them to a
          canteen from that canteen&rsquo;s page, which writes both.
        </p>
      </section>
    </>
  );
}
