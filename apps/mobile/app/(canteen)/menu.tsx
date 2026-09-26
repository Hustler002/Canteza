import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isAwaitingOnboarding, type MenuItem } from '@canteza/api';
import { formatPaise, paiseToRupees, parsePriceRupees, toAppError } from '@canteza/shared';
import { useCanteenMenu, useCreateMenuItem, useUpdateMenuItem } from '../../src/lib/queries';
import { useIdentity } from '../../src/lib/session';
import {
  Badge,
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Heading,
  Loading,
  Screen,
} from '../../src/components/ui';
import { Thumb } from '../../src/components/patterns';
import { useTheme } from '../../src/theme';

/**
 * The counter's menu.
 *
 * Built around the thing that actually happens during service: the samosas run out
 * at 13:00 and someone needs to say so in one tap, from the same phone that is
 * taking orders. Everything else here — the price, the name, adding a dish — is
 * setup work that happens once and can afford a second tap.
 *
 * The admin has the same powers from the dashboard, and needs them to stock a new
 * canteen before anyone is posted to it. This screen is the one that gets used
 * daily, because an admin is not standing at the counter.
 *
 * Writes go straight to `menu_items`: it withholds no column and
 * `menu_items_own_canteen` ties every row to `my_canteen_id()`, so the policy is
 * what scopes this, not the id this screen happens to pass.
 */

export default function CanteenMenu() {
  const t = useTheme();
  const router = useRouter();
  const identity = useIdentity();
  const canteenId = identity.canteenId ?? '';
  const menu = useCanteenMenu(canteenId);

  if (isAwaitingOnboarding(identity)) {
    return (
      <Screen>
        <EmptyState
          title="Waiting for setup"
          body="This account is not linked to a canteen yet. An admin needs to finish onboarding it."
        />
      </Screen>
    );
  }

  const items = menu.data ?? [];
  const live = items.filter((item) => item.is_active);

  return (
    <Screen padded={false}>
      <View style={{ padding: t.space.lg, paddingBottom: 0, gap: t.space.sm }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Heading level="display">Menu</Heading>
          <Button label="Orders" variant="secondary" onPress={() => router.push('/orders')} />
        </View>
        <Body muted>
          {live.length} {live.length === 1 ? 'dish' : 'dishes'} on sale. Sold out hides a dish for
          today; removing it takes it off the menu for good.
        </Body>
      </View>

      {menu.isLoading ? (
        <Loading label="Loading the menu…" />
      ) : menu.isError ? (
        <ErrorState
          message={toAppError(menu.error).userMessage}
          onRetry={() => void menu.refetch()}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}
          ListEmptyComponent={
            <EmptyState
              title="Nothing on the menu"
              body="Students can find this canteen but cannot order from it until it has a dish."
            />
          }
          ListFooterComponent={<NewItemCard canteenId={canteenId} />}
          renderItem={({ item }) => <MenuRow item={item} />}
        />
      )}
    </Screen>
  );
}

/**
 * One dish.
 *
 * Collapsed, it is the sold-out switch and nothing else, because that is the only
 * button anyone presses mid-service. Opening it reveals the price and the name,
 * which change once a term.
 */
function MenuRow({ item }: { item: MenuItem }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(paiseToRupees(item.price_paise)));
  const [imageUrl, setImageUrl] = useState(item.image_url ?? '');
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateMenuItem();

  const patch = (next: Parameters<typeof update.mutate>[0]['patch']) => {
    setError(null);
    update.mutate(
      { itemId: item.id, patch: next },
      { onError: (cause) => setError(toAppError(cause).userMessage) },
    );
  };

  const save = () => {
    const pricePaise = parsePriceRupees(price);
    if (pricePaise === null) {
      setError('A price has to be more than zero.');
      return;
    }
    if (!name.trim()) {
      setError('A dish needs a name.');
      return;
    }
    // An empty box means "no picture", which is null in the column rather than an
    // empty string -- `Thumb` tests for a URL, and '' is not one.
    const trimmedUrl = imageUrl.trim();
    patch({
      name: name.trim(),
      price_paise: pricePaise,
      image_url: trimmedUrl === '' ? null : trimmedUrl,
    });
    setOpen(false);
  };

  return (
    <Card>
      <Pressable
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${item.name}, ${formatPaise(item.price_paise)}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}
      >
        <Thumb name={item.name} uri={item.image_url} size={44} />
        <View style={{ flex: 1, gap: t.space.xs }}>
          <Heading level="heading">{item.name}</Heading>
          <Body muted>{formatPaise(item.price_paise)}</Body>
        </View>
        {!item.is_active ? (
          <Badge label="off the menu" tone="danger" />
        ) : item.is_available ? null : (
          <Badge label="sold out" tone="info" />
        )}
      </Pressable>

      {item.is_active ? (
        <Button
          label={item.is_available ? 'Mark sold out' : 'Back in stock'}
          variant={item.is_available ? 'secondary' : 'primary'}
          loading={update.isPending}
          onPress={() => patch({ is_available: !item.is_available })}
        />
      ) : (
        <Button
          label="Put it back on the menu"
          variant="secondary"
          loading={update.isPending}
          onPress={() => patch({ is_active: true })}
        />
      )}

      {open ? (
        <View style={{ gap: t.space.md }}>
          <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
          <Field
            label="Price (₹)"
            value={price}
            onChangeText={setPrice}
            keyboardType="number-pad"
          />
          {/*
           * A photo is optional and stays optional. With no URL the student's menu
           * gives the space back to the dish name rather than showing an empty box,
           * so a counter that never adds one still looks deliberate -- and a counter
           * that does gets the picture on the student's list immediately.
           */}
          <Field
            label="Photo link (optional)"
            value={imageUrl}
            onChangeText={setImageUrl}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            hint="Leave empty for no photo."
          />
          {imageUrl.trim() ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              <Thumb name={name} uri={imageUrl.trim()} size={56} />
              <Body muted>This is how it will look on the menu.</Body>
            </View>
          ) : null}
          <FormError message={error} />
          <Button label="Save" loading={update.isPending} onPress={save} />
          {item.is_active ? (
            /*
             * Not a delete. `order_items` points at this row with no `on delete`
             * clause, so Postgres refuses to remove a dish anyone has ordered — the
             * key is kept on purpose, for reorder and analytics. Taking it off the
             * menu is the only retirement there is.
             */
            <Button
              label="Take off the menu"
              variant="danger"
              loading={update.isPending}
              onPress={() => patch({ is_active: false })}
            />
          ) : null}
        </View>
      ) : null}
      {!open ? <FormError message={error} /> : null}
    </Card>
  );
}

/** Adding a dish: the two things a dish cannot exist without. The rest is admin work. */
function NewItemCard({ canteenId }: { canteenId: string }) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateMenuItem();

  const add = () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('A dish needs a name.');
      return;
    }
    const pricePaise = parsePriceRupees(price);
    if (pricePaise === null) {
      setError('A price has to be more than zero.');
      return;
    }

    create.mutate(
      { canteen_id: canteenId, name: trimmed, price_paise: pricePaise },
      {
        onSuccess: () => {
          setName('');
          setPrice('');
        },
        onError: (cause) => setError(toAppError(cause).userMessage),
      },
    );
  };

  return (
    <Card style={{ marginTop: t.space.md }}>
      <Heading level="heading">Add a dish</Heading>
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
      <Field label="Price (₹)" value={price} onChangeText={setPrice} keyboardType="number-pad" />
      <FormError message={error} />
      <Button label="Add to the menu" loading={create.isPending} onPress={add} />
    </Card>
  );
}
