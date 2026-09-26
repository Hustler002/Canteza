import { View } from 'react-native';
import { router } from 'expo-router';
import type { OrderWithItems } from '@canteza/api';
import { useMenu } from '../lib/queries';
import { useCart } from '../store/cart';
import { Body, Button } from './ui';
import { useTheme } from '../theme';

/**
 * Reorder, shared by the order tracker and the history list.
 *
 * It lives here rather than inside either screen because §12 wants repeating an
 * order to be reachable from the history list, and a second copy of this logic is
 * exactly how the two would drift on which dishes they drop.
 *
 * What it copies is ids and quantities and nothing else (rule 17), so the basket is
 * priced at today's menu rather than at what the receipt says. Dishes that have been
 * retired or sold out are left behind, because `place_order` re-reads every price
 * from `menu_items` and a line pointing at something off the menu cannot be priced
 * at all -- so the screen says so before the tap rather than failing after it.
 */
export function ReorderButton({
  order,
  compact = false,
}: {
  order: OrderWithItems;
  compact?: boolean;
}) {
  const t = useTheme();
  const menu = useMenu(order.canteen_id);
  const { clear, add } = useCart();

  if (menu.isLoading) return null;

  const orderable = new Set(
    (menu.data ?? []).filter((item) => item.is_available).map((item) => item.id),
  );
  const lines = (order.order_items ?? []).filter(
    (item) => item.menu_item_id && orderable.has(item.menu_item_id),
  );
  const dropped = (order.order_items ?? []).length - lines.length;

  if (lines.length === 0) {
    return compact ? null : <Body muted>Nothing from this order is on the menu right now.</Body>;
  }

  function reorder() {
    // Clear first: the cart belongs to one canteen, and `add` refuses to mix rather
    // than silently dropping what was there.
    clear();
    for (const line of lines) {
      if (line.menu_item_id) add(order.canteen_id, line.menu_item_id, line.quantity);
    }
    router.push('/cart');
  }

  // On a history row the caption would repeat down the whole list, so the compact
  // form is the button alone; the tracker keeps the explanation.
  if (compact) {
    return <Button label="Order again" variant="secondary" onPress={reorder} />;
  }

  return (
    <View style={{ gap: t.space.sm }}>
      <Button label="Order this again" variant="secondary" onPress={reorder} />
      <Body muted>
        {dropped > 0
          ? `${dropped} ${dropped === 1 ? 'dish is' : 'dishes are'} unavailable and will be left out. `
          : ''}
        Today&apos;s prices apply, not the ones on this receipt.
      </Body>
    </View>
  );
}
