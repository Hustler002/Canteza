import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { readDefaultAddress } from '@canteza/api';
import {
  computeTotals,
  formatPaise,
  normaliseCouponCode,
  PLATFORM_DEFAULTS,
  toAppError,
  type PaymentMethod,
} from '@canteza/shared';
import {
  useCanteen,
  useCoupons,
  useHostels,
  useMenu,
  usePayForOrder,
  usePlaceOrder,
  useSaveDefaultAddress,
} from '../../src/lib/queries';
import { useIdentity, useSession } from '../../src/lib/session';
import { isOnlinePaymentAvailable } from '../../src/lib/razorpay';
import { useCart } from '../../src/store/cart';
import {
  Badge,
  Button,
  Card,
  Field,
  FormError,
  Loading,
  Overline,
  Screen,
} from '../../src/components/ui';
import { MoneyRow } from '../../src/components/order';
import {
  AppBar,
  CardTitle,
  CheckRow,
  Chip,
  Divider,
  Icon,
  OptionCard,
} from '../../src/components/patterns';
import { useTheme } from '../../src/theme';

export default function Checkout() {
  const t = useTheme();
  const identity = useIdentity();
  const { refresh } = useSession();
  const canteenId = useCart((state) => state.canteenId);
  const lines = useCart((state) => state.lines);
  const clearCart = useCart((state) => state.clear);

  const canteen = useCanteen(canteenId ?? '');
  const menu = useMenu(canteenId ?? '');
  const hostels = useHostels();
  const coupons = useCoupons();
  const place = usePlaceOrder();
  const pay = usePayForOrder();
  const saveAddress = useSaveDefaultAddress(identity.userId);

  const saved = readDefaultAddress(identity.profile);
  const [hostelId, setHostelId] = useState(saved?.hostelId ?? '');
  const [block, setBlock] = useState(saved?.block ?? '');
  const [room, setRoom] = useState(saved?.room ?? '');
  const [note, setNote] = useState('');
  const [coupon, setCoupon] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(saved === null);
  const [error, setError] = useState<string | null>(null);

  // Asked once: whether the native sheet is compiled into this build does not change
  // while the app runs. In Expo Go it is not, and the choice is simply not offered.
  const [onlineAvailable] = useState(isOnlinePaymentAvailable);
  const [method, setMethod] = useState<PaymentMethod>(onlineAvailable ? 'razorpay' : 'cod');

  /**
   * Generated once when checkout opens, not per submit. A double tap, or a retry
   * after the response is lost, reuses this key and resolves to the same order.
   */
  const idempotencyKey = useMemo(() => randomUUID(), []);

  const cartEmpty = !canteenId || lines.length === 0;

  /**
   * Arrived here with nothing to buy — decided **once, at mount**, and never again.
   *
   * Two bugs live at this spot, and the second is the reason this reads the store
   * directly instead of using `cartEmpty`.
   *
   * The first: this used to run during render, which navigates while React is still
   * rendering and produces "Cannot update a component while rendering a different
   * component". Expo Go never surfaced it; the development build reported it on the
   * first open.
   *
   * The second was the same root cause wearing different clothes, and is why the
   * dependency array is empty. `submit()` clears the cart on its way to the order
   * tracker. Any guard that *watches* the cart — the original render-time check, or
   * an effect keyed on `[cartEmpty]` — sees it empty and replaces the tracker with
   * the home screen, so a student places a real order and never sees it. On a device
   * that presented as "checkout works but the order vanishes", which looks nothing
   * like the console warning above and is the same line of code.
   *
   * So the values come from `getState()` rather than a subscription. Nothing here
   * watches the cart after mount, which means clearing it cannot navigate at all —
   * no flag that has to win a race, and no race to win. The cost is that emptying the
   * cart elsewhere would not redirect, which is not a thing a phone can do.
   */
  useEffect(() => {
    const cart = useCart.getState();
    if (!cart.canteenId || cart.lines.length === 0) router.replace('/');
  }, []);

  // Purely visual: render nothing rather than a ₹0 checkout during the moment between
  // `clearCart()` and the tracker appearing. This must never navigate.
  if (cartEmpty) return null;
  if (menu.isLoading || hostels.isLoading) return <Loading label="Preparing checkout…" />;

  const menuById = new Map((menu.data ?? []).map((item) => [item.id, item]));
  const priced = lines
    .filter((line) => menuById.has(line.itemId))
    .map((line) => ({
      itemId: line.itemId,
      unitPricePaise: menuById.get(line.itemId)!.price_paise,
      quantity: line.quantity,
    }));
  const totals = computeTotals({
    lines: priced,
    deliveryFeePaise: PLATFORM_DEFAULTS.deliveryFeePaise,
  });

  const hostel = (hostels.data ?? []).find((h) => h.id === hostelId);
  const blocks = hostel?.blocks ?? [];
  const addressComplete = Boolean(hostelId && block && room.trim());

  const code = normaliseCouponCode(coupon);

  async function submit() {
    setError(null);
    try {
      const orderId = await place.mutateAsync({
        canteenId: canteenId!,
        items: lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
        hostelId,
        block,
        room,
        idempotencyKey,
        note,
        // The database has the last word on every coupon rule -- the minimum, the
        // per-student limit, the total cap. This only decides what to send, and
        // sends nothing when the field is empty (rule 4).
        couponCode: code || null,
        paymentMethod: method,
      });

      if (saveAsDefault) {
        // Best effort: a failure to remember the address must not lose the order
        // that was already placed.
        try {
          await saveAddress.mutateAsync({ hostelId, block, room });
          await refresh();
        } catch {
          /* ignore */
        }
      }

      // A prepaid order now exists, unpaid, and the sheet opens on it. Whatever
      // happens in there, the student lands on the order: it says whether the money
      // arrived, and offers to try again if it did not. That is also why a failure to
      // *open* the sheet is not shown here -- the order screen shows the same choice
      // with a working retry, and staying on checkout would invite placing it twice.
      let confirming = false;
      if (method === 'razorpay') {
        try {
          confirming = (await pay.mutateAsync(orderId)).kind === 'submitted';
        } catch {
          /* the order screen offers "Pay" again */
        }
      }

      // Navigate first, then empty the cart. The guard above no longer watches the
      // cart, so this ordering is belt to its braces rather than the fix itself —
      // but it means that even if something here re-renders, the route has already
      // changed and there is no checkout screen left to redirect.
      router.replace(`/order/${orderId}${confirming ? '?confirming=1' : ''}`);
      clearCart();
    } catch (err) {
      setError(toAppError(err).userMessage);
    }
  }

  return (
    <Screen
      scroll
      footer={
        <>
          <FormError message={error} />
          {!addressComplete ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
              <Icon name="information-circle-outline" size={16} color={t.color.textMuted} />
              <Text style={[t.font.caption, { color: t.color.textMuted }]}>
                Pick a hostel, block and room to continue.
              </Text>
            </View>
          ) : null}
          {/*
           * The total rides on the button and the button is always on screen, so it
           * stays visible however far down the form the student has scrolled (§10).
           */}
          <Button
            icon={method === 'razorpay' ? 'lock-closed' : 'checkmark-circle'}
            label={
              method !== 'razorpay'
                ? `Place order · ${formatPaise(totals.totalPaise)}`
                : code
                  ? // The discount is `place_order`'s to decide (see the coupon card), so
                    // with a code entered this screen does not know the amount. The sheet
                    // does, and shows it; a figure here would overstate the charge.
                    'Continue to payment'
                  : `Pay ${formatPaise(totals.totalPaise)}`
            }
            size="lg"
            onPress={submit}
            // Both steps, so the button stays busy from the tap until the sheet is up
            // and a second tap cannot land in the gap between them.
            loading={place.isPending || pay.isPending}
            disabled={!addressComplete}
          />
        </>
      }
    >
      <AppBar
        title="Checkout"
        subtitle={canteen.data?.name ?? undefined}
        onBack={() => router.back()}
      />

      <Card>
        <CardTitle
          icon="location-outline"
          title="Deliver to"
          subtitle="Your hostel, block and room"
        />

        <Overline>Hostel</Overline>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {(hostels.data ?? []).map((h) => (
            <Chip
              key={h.id}
              icon="business-outline"
              label={h.name}
              selected={h.id === hostelId}
              onPress={() => {
                setHostelId(h.id);
                setBlock('');
              }}
            />
          ))}
        </View>

        {blocks.length > 0 ? (
          <>
            <Overline>Block</Overline>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
              {blocks.map((b) => (
                <Chip key={b} label={b} selected={b === block} onPress={() => setBlock(b)} />
              ))}
            </View>
          </>
        ) : null}

        <Field
          label="Room number"
          value={room}
          onChangeText={setRoom}
          placeholder="214"
          autoCapitalize="characters"
        />
        <Field
          label="Delivery note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Less spicy, call when you reach"
        />

        <CheckRow
          label="Remember this address"
          checked={saveAsDefault}
          onToggle={() => setSaveAsDefault(!saveAsDefault)}
        />
      </Card>

      <Card>
        <CardTitle icon="pricetag-outline" title="Offers" subtitle="Apply a coupon code" />
        <Field
          label="Code (optional)"
          value={coupon}
          onChangeText={setCoupon}
          placeholder="WELCOME50"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {/*
         * The discount is not shown in the summary below on purpose. `place_order`
         * is what applies it -- it re-reads the coupon, checks the minimum and the
         * redemption limits, and caps it at the subtotal -- so a figure computed
         * here would be a guess that disagrees with the receipt whenever a rule
         * bites. The order screen shows what was actually allowed.
         */}
        {(coupons.data ?? []).length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
            {(coupons.data ?? []).map((available) => (
              <Chip
                key={available.id}
                icon="ticket-outline"
                label={
                  available.min_order_paise > 0
                    ? `${available.code} · over ${formatPaise(available.min_order_paise)}`
                    : available.code
                }
                selected={code === available.code}
                onPress={() => setCoupon(code === available.code ? '' : available.code)}
              />
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <CardTitle icon="wallet-outline" title="Payment" subtitle="How would you like to pay?" />
        {onlineAvailable ? (
          <View style={{ gap: t.space.sm }}>
            <OptionCard
              icon="card-outline"
              title="Pay online"
              subtitle="Cards, wallets, netbanking and UPI where available"
              selected={method === 'razorpay'}
              onPress={() => setMethod('razorpay')}
            />
            <OptionCard
              icon="cash-outline"
              title="Cash on delivery"
              subtitle="Pay when it reaches your room"
              selected={method === 'cod'}
              onPress={() => setMethod('cod')}
            />
          </View>
        ) : (
          <Badge label="Pay cash on delivery" tone="info" />
        )}
        {method === 'razorpay' ? (
          <Text style={[t.font.caption, { color: t.color.textMuted }]}>
            The canteen sees your order as soon as the payment is confirmed. If a coupon applies,
            the payment screen shows the discounted total.
          </Text>
        ) : null}
      </Card>

      <Card>
        <Overline>Bill details</Overline>
        <MoneyRow label="Item total" amountPaise={totals.subtotalPaise} />
        <MoneyRow label="Delivery to your room" amountPaise={totals.deliveryFeePaise} />
        <Divider dashed />
        <MoneyRow label="To pay" amountPaise={totals.totalPaise} strong />
      </Card>
    </Screen>
  );
}
