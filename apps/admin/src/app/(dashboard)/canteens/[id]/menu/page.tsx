import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatPaise, paiseToRupees, type Row } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SearchParams } from '@/lib/order-filters';
import { createMenuItem, setMenuItemActive, updateMenuItem } from './actions';

/**
 * What a canteen sells.
 *
 * The third step of the flow `admin_create_canteen` was written for — create the canteen
 * disabled, attach staff, add a menu, then enable it — and the one that had no screen
 * until now. `menu_items` has had its grant and its policies since Phase 2 with nothing
 * writing to it.
 *
 * It lives on the canteen rather than as a top-level page for the same reason the staff
 * and delivery sections do: every item belongs to exactly one canteen, so arriving from
 * the canteen means there is no canteen picker to build and no way to file an item under
 * the wrong counter.
 *
 * Each item is a `<details>`. A menu is a list to scan and occasionally one row to edit,
 * so 28 open forms would bury the list they belong to — and the native element collapses
 * them with no JavaScript and no client component.
 */

type MenuItem = Row<'menu_items'>;
type Category = Row<'food_categories'>;

export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const error = typeof query.error === 'string' ? query.error : null;
  const saved = typeof query.saved === 'string' ? query.saved : null;

  const supabase = await createServerSupabase();
  const [canteenRead, itemsRead, categoriesRead] = await Promise.all([
    supabase.from('canteens').select('id, name, is_active').eq('id', id).maybeSingle(),
    // Retired items are read too — an admin has to be able to bring one back, and
    // `menu_items_read` shows an admin every row anyway.
    supabase
      .from('menu_items')
      .select('*')
      .eq('canteen_id', id)
      .order('is_active', { ascending: false })
      .order('sort_order')
      .order('name'),
    supabase.from('food_categories').select('*').order('sort_order'),
  ]);

  const canteen = canteenRead.data;
  if (!canteen) notFound();

  const items = itemsRead.data ?? [];
  const categories = categoriesRead.data ?? [];
  const live = items.filter((item) => item.is_active);

  return (
    <>
      <section className="card">
        <Link className="muted" href={`/canteens/${id}`}>
          ← {canteen.name}
        </Link>
        <div className="topbar">
          <h2>Menu</h2>
          <span className="badge">
            {live.length} {live.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="muted">Saved {saved}.</p> : null}
        {itemsRead.error ? <p className="error">{itemsRead.error.message}</p> : null}
        <p className="muted">
          Changing a price changes what the next order costs, never what a past one did — receipts
          keep the name and price they were charged at. <strong>Sold out</strong> hides an item for
          today and keeps it on the menu; <strong>retiring</strong> takes it off altogether, which
          is the only way to remove one, because an item someone has ordered cannot be deleted.
        </p>
        {canteen.is_active ? null : (
          <p className="muted">
            This canteen is disabled, so nothing here is on a student&rsquo;s menu yet. Stock it
            first, then enable it from the canteens list.
          </p>
        )}
      </section>

      <section className="card">
        <h3>Items</h3>
        {items.length === 0 ? (
          <p className="muted">
            Nothing on the menu yet. A canteen with no items can be browsed but not ordered from.
          </p>
        ) : (
          items.map((item) => (
            <details className="item" key={item.id}>
              <summary>
                <span className="item-name">{item.name}</span>
                <span className="muted">{formatPaise(item.price_paise)}</span>
                {item.is_active ? null : <span className="badge bad">retired</span>}
                {item.is_active && !item.is_available ? (
                  <span className="badge">sold out</span>
                ) : null}
              </summary>

              <form className="stack" action={updateMenuItem.bind(null, id, item.id)}>
                <MenuFields item={item} categories={categories} />
                <div className="toolbar">
                  <button className="button" type="submit">
                    Save
                  </button>
                </div>
              </form>

              <form action={setMenuItemActive.bind(null, id, item.id, !item.is_active)}>
                <button className="button secondary" type="submit">
                  {item.is_active ? 'Retire' : 'Restore'}
                </button>
              </form>
            </details>
          ))
        )}
      </section>

      <section className="card">
        <h3>New item</h3>
        <form className="stack" action={createMenuItem.bind(null, id)}>
          <MenuFields item={null} categories={categories} />
          <div className="toolbar">
            <button className="button" type="submit">
              Add item
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

/**
 * The fields, shared by editing and adding.
 *
 * `item` being null makes it the create form. A new item is available by default — the
 * column default agrees — because adding something to a menu means you sell it; that is
 * the opposite of a new canteen, which starts disabled precisely because it has no menu.
 */
function MenuFields({ item, categories }: { item: MenuItem | null; categories: Category[] }) {
  return (
    <>
      <div className="row">
        <div className="field">
          <label htmlFor={fieldId('name', item)}>Name</label>
          <input
            id={fieldId('name', item)}
            name="name"
            defaultValue={item?.name ?? ''}
            maxLength={80}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={fieldId('price', item)}>Price (₹)</label>
          <input
            id={fieldId('price', item)}
            name="price_rupees"
            type="number"
            min="1"
            step="1"
            defaultValue={item ? paiseToRupees(item.price_paise) : ''}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={fieldId('category', item)}>Category</label>
          <select
            id={fieldId('category', item)}
            name="category_id"
            defaultValue={item?.category_id ?? ''}
          >
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor={fieldId('description', item)}>Description</label>
        <input
          id={fieldId('description', item)}
          name="description"
          defaultValue={item?.description ?? ''}
        />
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor={fieldId('image', item)}>Image URL</label>
          <input
            id={fieldId('image', item)}
            name="image_url"
            defaultValue={item?.image_url ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor={fieldId('sort', item)}>Sort order</label>
          <input
            id={fieldId('sort', item)}
            name="sort_order"
            type="number"
            min="0"
            step="1"
            defaultValue={item?.sort_order ?? 0}
          />
          <span className="muted">Lower sorts first; ties fall back to the name.</span>
        </div>
      </div>

      <label className="check">
        <input type="checkbox" name="is_veg" defaultChecked={item?.is_veg ?? true} />
        <span>Vegetarian</span>
      </label>

      <label className="check">
        <input type="checkbox" name="is_available" defaultChecked={item?.is_available ?? true} />
        <span>
          Available
          <span className="muted">
            {' '}
            — unchecked shows it to students as sold out rather than hiding it.
          </span>
        </span>
      </label>
    </>
  );
}

/** Every item's form is on one page, so an id has to say which item it belongs to. */
function fieldId(field: string, item: MenuItem | null): string {
  return item ? `${field}-${item.id}` : `new-${field}`;
}
