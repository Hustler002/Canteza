import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { readDefaultAddress } from '@canteza/api';
import {
  computeTotals,
  formatPaise,
  normaliseCouponCode,
  PLATFORM_DEFAULTS,
  toAppError,
} from '@canteza/shared';
import {
  useCanteen,
  useCoupons,
  useHostels,
  useMenu,
  usePlaceOrder,
  useSaveDefaultAddress,
} from '../../src/lib/queries';
import { useIdentity, useSession } from '../../src/lib/session';
import { useCart } from '../../src/store/cart';
import {
  Badge,
  Body,
  Button,
  Card,
  Field,
  FormError,
  Heading,
  Loading,
  Screen,
} from '../../src/components/ui';
import { MoneyRow } from '../../src/components/order';
import { AppBar, Chip } from '../../src/components/patterns';
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
  const saveAddress = useSaveDefaultAddress(identity.userId);

  const saved = readDefaultAddress(identity.profile);
  const [hostelId, setHostelId] = useState(saved?.hostelId ?? '');
  const [block, setBlock] = useState(saved?.block ?? '');
  const [room, setRoom] = useState(saved?.room ?? '');
  const [note, setNote] = useState('');
  const [coupon, setCoupon] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(saved === null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Generated once when checkout opens, not per submit. A double tap, or a retry
   * after the response is lost, reuses this key and resolves to the same order.
   */
  const idempotencyKey = useMemo(() => randomUUID(), []);

  if (!canteenId || lines.length === 0) {
    router.replace('/');
    return null;
  }
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

      clearCart();
      router.replace(`/order/${orderId}`);
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
          {!addressComplete ? <Body muted>Pick a hostel, block and room to continue.</Body> : null}
          {/*
           * The total rides on the button and the button is always on screen, so it
           * stays visible however far down the form the student has scrolled (§10).
           */}
          <Button
            label={`Place order · ${formatPaise(totals.totalPaise)}`}
            onPress={submit}
            loading={place.isPending}
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
        <Heading level="heading">Deliver to</Heading>

        <Body muted>Hostel</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {(hostels.data ?? []).map((h) => (
            <Chip
              key={h.id}
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
            <Body muted>Block</Body>
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

        <Pressable
          onPress={() => setSaveAsDefault(!saveAsDefault)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: saveAsDefault }}
          hitSlop={t.hitSlop}
        >
          <Badge
            label={saveAsDefault ? '✓ Remember this address' : 'Remember this address'}
            tone={saveAsDefault ? 'primary' : 'neutral'}
          />
        </Pressable>
      </Card>

      <Card>
        <Heading level="heading">Coupon</Heading>
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
        <Heading level="heading">Payment</Heading>
        <MoneyRow label="Subtotal" amountPaise={totals.subtotalPaise} />
        <MoneyRow label="Delivery" amountPaise={totals.deliveryFeePaise} />
        <MoneyRow label="Total" amountPaise={totals.totalPaise} strong />
        <Badge label="Pay cash on delivery" tone="info" />
      </Card>
    </Screen>
  );
}
