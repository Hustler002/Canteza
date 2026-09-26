import type { ReactNode } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';

/**
 * Patterns: the compositions this app keeps needing.
 *
 * `ui.tsx` holds the vocabulary -- a button, a card, an input. This file holds the
 * sentences, so that "a chip" means one thing in Canteza rather than four slightly
 * different things on four screens. A screen composes from here first and only
 * reaches for a raw View when nothing fits.
 */

/**
 * The top bar, replacing the full-width "← Back" buttons that opened ten screens.
 *
 * Those cost a whole button's height of the most valuable space on the screen and
 * read as an action rather than as navigation. This is one 48pt row: a real touch
 * target for the arrow, the title where a title belongs, an optional action right.
 */
export function AppBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title?: string | undefined;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  right?: ReactNode;
}) {
  const t = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        minHeight: t.minTouchTarget,
      }}
    >
      {onBack ? <IconButton glyph="‹" label="Go back" onPress={onBack} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text style={[t.font.title, { color: t.color.text }]} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text style={[t.font.caption, { color: t.color.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/**
 * A square tap target for a single glyph. Square rather than circular because a
 * glyph centred in a square stays centred at every system font scale, and
 * `minTouchTarget` because that is the floor for a thumb.
 */
export function IconButton({
  glyph,
  label,
  onPress,
  tone = 'neutral',
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'primary';
}) {
  const t = useTheme();
  const primary = tone === 'primary';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={t.hitSlop}
      style={({ pressed }) => ({
        width: t.minTouchTarget,
        height: t.minTouchTarget,
        borderRadius: t.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? t.color.primary : t.color.surfaceAlt,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 24,
          lineHeight: 28,
          fontWeight: '600',
          color: primary ? t.color.onPrimary : t.color.text,
        }}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

/**
 * A category or filter chip. Unlike `Badge`, which reports state and is never
 * pressed, a chip is an action, so it carries a selected state and a touch target.
 */
export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: (() => void) | undefined;
}) {
  const t = useTheme();

  const body = (
    <View
      style={{
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.sm,
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: selected ? t.color.primary : t.color.border,
        backgroundColor: selected ? t.color.primary : t.color.surface,
        minHeight: 38,
        justifyContent: 'center',
      }}
    >
      <Text
        style={[t.font.label, { color: selected ? t.color.onPrimary : t.color.text }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/** A section title, with an optional action on the right ("See all"). */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: t.space.md,
      }}
    >
      <Text style={[t.font.subheading, { color: t.color.text }]}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={t.hitSlop}>
          <Text style={[t.font.label, { color: t.color.primary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A loading placeholder shaped like the thing that is coming.
 *
 * A spinner says "wait". A skeleton says "a list of cards is arriving", which is the
 * difference between a screen that feels slow and one that feels busy. It is a flat
 * block rather than an animated shimmer on purpose: a shimmer on every row of a list
 * is a lot of work for a mid-range Android to do while it is also fetching.
 */
export function Skeleton({
  height,
  width = '100%',
  radius,
}: {
  height: number;
  width?: number | `${number}%`;
  radius?: number | undefined;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height,
        width,
        borderRadius: radius ?? t.radius.sm,
        backgroundColor: t.color.surfaceAlt,
      }}
    />
  );
}

/** The skeleton for a list of cards, which is what most screens are waiting for. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.md }}>
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          style={[
            {
              backgroundColor: t.color.surface,
              borderRadius: t.radius.lg,
              borderWidth: 1,
              borderColor: t.color.border,
              padding: t.space.lg,
              gap: t.space.md,
            },
            t.elevation.card,
          ]}
        >
          <Skeleton height={18} width="55%" />
          <Skeleton height={13} width="80%" />
          <Skeleton height={13} width="35%" />
        </View>
      ))}
    </View>
  );
}

/**
 * Money.
 *
 * It takes an already-formatted string rather than paise, because `formatPaise` is
 * the single formatter in this codebase (rule 1) and a component that did its own
 * conversion would quietly become a second one.
 */
export function Price({
  value,
  size = 'md',
  tone = 'default',
  strikethrough = false,
}: {
  value: string;
  size?: 'md' | 'lg';
  tone?: 'default' | 'muted' | 'primary';
  strikethrough?: boolean;
}) {
  const t = useTheme();
  const color =
    tone === 'muted' ? t.color.textMuted : tone === 'primary' ? t.color.primary : t.color.text;

  return (
    <Text
      style={[
        size === 'lg' ? t.font.priceLg : t.font.price,
        { color },
        strikethrough ? { textDecorationLine: 'line-through' as const } : null,
      ]}
    >
      {value}
    </Text>
  );
}

/**
 * The add / quantity control.
 *
 * At zero it is a single wide "Add", so the common case is one tap. Once there is a
 * quantity it becomes − n + in the same footprint, so the row never reflows and the
 * next item does not jump out from under a finger. The count is tabular and fixed
 * width, so 9 → 10 does not shove the buttons sideways.
 */
export function QtyStepper({
  quantity,
  onAdd,
  onRemove,
  disabled = false,
  addLabel = 'Add',
  accessibilityName,
}: {
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
  disabled?: boolean;
  addLabel?: string;
  accessibilityName: string;
}) {
  const t = useTheme();

  if (quantity === 0) {
    return (
      <Pressable
        onPress={onAdd}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${addLabel} ${accessibilityName}`}
        accessibilityState={{ disabled }}
        style={({ pressed }) => ({
          minHeight: 40,
          minWidth: 92,
          paddingHorizontal: t.space.lg,
          borderRadius: t.radius.md,
          borderWidth: 1.5,
          borderColor: disabled ? t.color.border : t.color.primary,
          backgroundColor: disabled ? t.color.surfaceAlt : t.color.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={[t.font.label, { color: disabled ? t.color.textFaint : t.color.primary }]}>
          {addLabel}
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 40,
        minWidth: 92,
        borderRadius: t.radius.md,
        backgroundColor: t.color.primary,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove one ${accessibilityName}`}
        style={({ pressed }) => ({
          paddingHorizontal: t.space.md,
          height: 40,
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ color: t.color.onPrimary, fontSize: 20, fontWeight: '700' }}>−</Text>
      </Pressable>
      <Text
        accessibilityLabel={`${quantity} in cart`}
        style={{
          flex: 1,
          textAlign: 'center',
          color: t.color.onPrimary,
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
        }}
      >
        {quantity}
      </Text>
      <Pressable
        onPress={onAdd}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Add one more ${accessibilityName}`}
        style={({ pressed }) => ({
          paddingHorizontal: t.space.md,
          height: 40,
          justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ color: t.color.onPrimary, fontSize: 20, fontWeight: '700' }}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * A thumbnail for a dish or a canteen -- when there is one.
 *
 * **Today there are none.** `menu_items.image_url` and `canteens.image_url` exist in
 * the schema, but `seed.sql` never sets one, so every row in the live database has
 * null. A layout that reserves a square for a photo that does not exist is a list of
 * empty boxes, so this renders *nothing* rather than a placeholder, and the row it
 * sits in gives the space back to the name. A canteen adding a photo later makes the
 * thumbnail appear and the text reflow around it -- no second layout, no empty slot
 * in the meantime.
 *
 * `fallback="initial"` opts into a tinted initial for places where the absence would
 * look like a rendering fault rather than a design -- a large canteen header, say,
 * rather than a dense menu row. The tint is derived from the name so a given dish is
 * the same colour on every render; a list that reshuffles its colours as it refetches
 * looks broken.
 */
const THUMB_TINTS = ['primarySoft', 'successSoft', 'infoSoft', 'dangerSoft'] as const;

export function Thumb({
  name,
  uri,
  size = 56,
  fallback = 'none',
}: {
  name: string;
  uri?: string | null | undefined;
  size?: number;
  fallback?: 'none' | 'initial';
}) {
  const t = useTheme();

  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityIgnoresInvertColors
        accessibilityLabel={name}
        resizeMode="cover"
        style={{
          width: size,
          height: size,
          borderRadius: t.radius.md,
          backgroundColor: t.color.surfaceAlt,
        }}
      />
    );
  }

  if (fallback === 'none') return null;

  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash += name.charCodeAt(i);
  const key = THUMB_TINTS[hash % THUMB_TINTS.length] ?? 'primarySoft';

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: t.radius.md,
        backgroundColor: t.color[key],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.36, fontWeight: '700', color: t.color.text }}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * The veg / non-veg mark, as the square-in-a-square used on Indian menus.
 *
 * Drawn rather than coloured text because colour alone must not carry the meaning
 * (a red dot and a green dot are the same dot to a red-green colourblind student),
 * so it also carries an accessibility label.
 */
export function VegMark({ veg }: { veg: boolean }) {
  const t = useTheme();
  const color = veg ? t.color.success : t.color.danger;

  return (
    <View
      accessibilityLabel={veg ? 'Vegetarian' : 'Non-vegetarian'}
      style={{
        width: 14,
        height: 14,
        borderWidth: 1.5,
        borderColor: color,
        borderRadius: 3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

/**
 * A canteen's rating, as a star, a number and how many people said so.
 *
 * The count is not decoration: 4.9 from three reviews and 4.3 from two hundred are
 * very different claims, and showing only the average makes them look identical.
 * Below a handful of reviews there is no average worth printing, so it says "New"
 * instead of implying a verdict the data cannot support.
 */
export function Rating({
  average,
  count,
  minimum = 3,
}: {
  average: number | null | undefined;
  count: number | null | undefined;
  minimum?: number;
}) {
  const t = useTheme();
  const reviews = count ?? 0;

  if (typeof average !== 'number' || reviews < minimum) {
    return (
      <Text
        style={[t.font.caption, { color: t.color.textMuted }]}
        accessibilityLabel="Not enough ratings yet"
      >
        New
      </Text>
    );
  }

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
      accessibilityLabel={`Rated ${average} out of 5 by ${reviews} ${reviews === 1 ? 'person' : 'people'}`}
    >
      {/* The star is decoration beside a number that already says it, so it is
       * hidden rather than read out as "black star". */}
      <Text accessibilityElementsHidden style={{ fontSize: 12, color: t.color.success }}>
        ★
      </Text>
      <Text style={[t.font.label, { color: t.color.text }]}>{average.toFixed(1)}</Text>
      <Text style={[t.font.caption, { color: t.color.textMuted }]}>({reviews})</Text>
    </View>
  );
}
