import { createServerSupabase } from '@/lib/supabase/server';
import { formatBlocks } from '@/lib/people-filters';
import type { SearchParams } from '@/lib/order-filters';
import { createHostel, setHostelActive, updateHostel } from './actions';

/**
 * The buildings food gets carried to.
 *
 * Four rows that rarely change, so everything is on one page — the list edits in place
 * rather than sending anyone to a detail route for two fields.
 *
 * Blocks are a `text[]`. The form round-trips them through "A, B, C", which is what the
 * student's checkout shows as choices, so a stray empty block here would appear there as
 * a nameless button.
 */
export default async function HostelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const saved = typeof params.saved === 'string' ? params.saved : null;

  const supabase = await createServerSupabase();
  const { data, error: readError } = await supabase
    .from('hostels')
    .select('id, name, blocks, is_active')
    .order('name');

  const hostels = data ?? [];

  return (
    <>
      <section className="card">
        <h2>Hostels</h2>
        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="muted">Saved {saved}.</p> : null}
        {readError ? <p className="error">{readError.message}</p> : null}
        <p className="muted">
          Disabling a hostel stops new orders going there. Students who live in it keep their saved
          address, and every order already delivered to it still reads correctly.
        </p>
      </section>

      {hostels.map((hostel) => (
        <section className="card" key={hostel.id}>
          <div className="topbar">
            <h3>{hostel.name}</h3>
            {hostel.is_active ? (
              <span className="badge ok">active</span>
            ) : (
              <span className="badge bad">disabled</span>
            )}
          </div>

          <form className="stack" action={updateHostel.bind(null, hostel.id)}>
            <div className="row">
              <div className="field">
                <label htmlFor={`name-${hostel.id}`}>Name</label>
                <input
                  id={`name-${hostel.id}`}
                  name="name"
                  defaultValue={hostel.name}
                  maxLength={80}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor={`blocks-${hostel.id}`}>Blocks</label>
                <input
                  id={`blocks-${hostel.id}`}
                  name="blocks"
                  defaultValue={formatBlocks(hostel.blocks)}
                  placeholder="A, B, C"
                />
                <span className="muted">
                  Comma separated. These are the choices a student picks from at checkout.
                </span>
              </div>
            </div>

            <div className="toolbar">
              <button className="button" type="submit">
                Save
              </button>
            </div>
          </form>

          <form action={setHostelActive.bind(null, hostel.id, !hostel.is_active)}>
            <button className="button secondary" type="submit">
              {hostel.is_active ? 'Disable' : 'Enable'}
            </button>
          </form>
        </section>
      ))}

      <section className="card">
        <h3>New hostel</h3>
        <form className="stack" action={createHostel}>
          <div className="row">
            <div className="field">
              <label htmlFor="new-name">Name</label>
              <input id="new-name" name="name" maxLength={80} required />
            </div>
            <div className="field">
              <label htmlFor="new-blocks">Blocks</label>
              <input id="new-blocks" name="blocks" placeholder="A, B, C" />
            </div>
          </div>
          <div className="toolbar">
            <button className="button" type="submit">
              Add hostel
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
