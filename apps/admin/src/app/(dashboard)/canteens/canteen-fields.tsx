import { paiseToRupees, type Row } from '@canteza/shared';

/**
 * The fields shared by creating and editing a canteen.
 *
 * `canteen` being null is what makes it a create form, and the two differences follow
 * from that: there is nothing to warn about renaming yet, and the pause switch is
 * meaningless on a canteen that starts disabled anyway.
 *
 * Not a client component — these are uncontrolled inputs with defaults, submitted to a
 * server action. Nothing here needs to react to a keystroke.
 */
export function CanteenFields({ canteen }: { canteen: Row<'canteens'> | null }) {
  return (
    <>
      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" defaultValue={canteen?.name ?? ''} maxLength={80} required />
        {canteen ? (
          <span className="muted">
            Past orders keep the name they were placed under, so renaming does not rewrite any
            receipt.
          </span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="description">Description</label>
        <input id="description" name="description" defaultValue={canteen?.description ?? ''} />
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="opens_at">Opens</label>
          <input
            id="opens_at"
            name="opens_at"
            type="time"
            defaultValue={canteen?.opens_at.slice(0, 5) ?? '08:00'}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="closes_at">Closes</label>
          <input
            id="closes_at"
            name="closes_at"
            type="time"
            defaultValue={canteen?.closes_at.slice(0, 5) ?? '22:00'}
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
            defaultValue={canteen ? paiseToRupees(canteen.min_order_paise) : 0}
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
          <input id="phone" name="phone" defaultValue={canteen?.phone ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="image_url">Image URL</label>
          <input id="image_url" name="image_url" defaultValue={canteen?.image_url ?? ''} />
        </div>
      </div>

      {canteen ? (
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
      ) : null}
    </>
  );
}
