import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Animated, Image, Platform, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme';
import { useReducedMotion, webInteractive, type InteractionState } from './motion';

/**
 * Patterns: the compositions this app keeps needing.
 *
 * `ui.tsx` holds the vocabulary -- a button, a card, an input. This file holds the
 * sentences, so that "a chip" means one thing in Canteza rather than four slightly
 * different things on four screens. A screen composes from here first and only
 * reaches for a raw View when nothing fits.
 */

/**
 * An icon from Ionicons, the set Expo ships. Decorative by default -- hidden from screen
 * readers, because every icon here sits beside words or inside a labelled button.
 */
export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({
  name,
  size = 20,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string | undefined;
}) {
  const t = useTheme();
  return (
    <Ionicons
      name={name}
      size={size}
      color={color ?? t.color.text}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

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
      {onBack ? <IconButton icon="chevron-back" label="Go back" onPress={onBack} /> : null}
      <View style={{ flex: 1, gap: t.space.xxs }}>
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
 * A round tap target for a single icon, floating on the page as a small white disc.
 *
 * `minTouchTarget` because that is the floor for a thumb. `badge` puts a count on it --
 * unread notifications, say -- and the count goes into the accessibility label rather
 * than being read out as a loose number; nothing is drawn at zero, because a badge
 * reading "0" is a thing to read that says there is nothing to read.
 */
export function IconButton({
  icon,
  label,
  onPress,
  tone = 'neutral',
  badge = 0,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'primary';
  badge?: number;
}) {
  const t = useTheme();
  const primary = tone === 'primary';

  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}
        hitSlop={t.hitSlop}
        style={(state) => {
          const { pressed, hovered } = state as InteractionState;
          return [
            {
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: primary
                ? t.color.primary
                : hovered
                  ? t.color.surfaceAlt
                  : t.color.surface,
              borderWidth: 1,
              borderColor: primary ? t.color.primary : t.color.cardBorder,
              transform: [{ scale: pressed ? 0.92 : 1 }],
            },
            primary ? null : t.elevation.card,
            webInteractive(t.motion.instant),
          ];
        }}
      >
        <Icon name={icon} size={21} color={primary ? t.color.onPrimary : t.color.text} />
      </Pressable>
      {badge > 0 ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            minWidth: 20,
            height: 20,
            paddingHorizontal: 5,
            borderRadius: t.radius.pill,
            backgroundColor: t.color.danger,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: t.color.background,
          }}
        >
          <Text
            style={{
              color: t.color.onPrimary,
              fontSize: 10,
              fontWeight: '800',
              fontVariant: ['tabular-nums'],
            }}
          >
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A category or filter chip. Unlike `Badge`, which reports state and is never
 * pressed, a chip is an action, so it carries a selected state and a touch target.
 *
 * Selected is a soft brand fill with a brand outline and brand text rather than a solid
 * orange slab: a row of five chips with one solid block in it shouts, and the choice
 * should be clear without being the loudest thing on the screen.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: (() => void) | undefined;
  icon?: IconName | undefined;
}) {
  const t = useTheme();

  const body = (hovered: boolean) => (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.xs + 2,
          paddingHorizontal: t.space.lg - 2,
          paddingVertical: t.space.sm,
          borderRadius: t.radius.pill,
          borderWidth: 1.5,
          borderColor: selected ? t.color.primary : hovered ? t.color.textFaint : t.color.border,
          backgroundColor: selected ? t.color.primarySoft : t.color.surface,
          minHeight: 40,
          justifyContent: 'center',
        },
        webInteractive(t.motion.instant),
      ]}
    >
      {icon ? (
        <Icon name={icon} size={15} color={selected ? t.color.primary : t.color.textMuted} />
      ) : null}
      <Text
        style={[t.font.label, { color: selected ? t.color.primary : t.color.text }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  if (!onPress) return body(false);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
    >
      {(state) => body(Boolean((state as InteractionState).hovered))}
    </Pressable>
  );
}

/** A section title, with an optional line under it and an action on the right ("See all"). */
export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: t.space.md,
      }}
    >
      <View style={{ flex: 1, gap: t.space.xxs }}>
        <Text style={[t.font.subheading, { color: t.color.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[t.font.caption, { color: t.color.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={t.hitSlop}>
          <Text style={[t.font.label, { color: t.color.primary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A hairline between rows that share a card. */
export function Divider({ dashed = false }: { dashed?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: t.color.border,
        borderStyle: dashed ? 'dashed' : 'solid',
      }}
    />
  );
}

/**
 * A small fact with an icon: "25 min", "₹30 minimum". Several sit in a row under a
 * canteen's name, where a sentence would be read and a row of these is scanned.
 */
export function Fact({
  icon,
  label,
  strong = false,
}: {
  icon?: IconName | undefined;
  label: string;
  strong?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
      {icon ? <Icon name={icon} size={14} color={t.color.textMuted} /> : null}
      <Text
        style={[
          strong ? t.font.label : t.font.caption,
          { color: strong ? t.color.text : t.color.textMuted },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * A loading placeholder shaped like the thing that is coming.
 *
 * A spinner says "wait". A skeleton says "a list of cards is arriving", which is the
 * difference between a screen that feels slow and one that feels busy. It breathes --
 * a slow opacity pulse -- because a perfectly still grey block reads as broken. The
 * pulse runs on the native driver, so it costs the JavaScript thread nothing while
 * that thread is busy fetching; with reduced motion on, it is still.
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
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height,
        width,
        borderRadius: radius ?? t.radius.sm,
        backgroundColor: t.color.surfaceAlt,
        opacity: pulse,
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
              flexDirection: 'row',
              gap: t.space.lg,
              backgroundColor: t.color.surface,
              borderRadius: t.radius.lg,
              borderWidth: 1,
              borderColor: t.color.cardBorder,
              padding: t.space.lg,
            },
            t.elevation.card,
          ]}
        >
          <Skeleton height={72} width={72} radius={t.radius.md} />
          <View style={{ flex: 1, gap: t.space.sm, justifyContent: 'center' }}>
            <Skeleton height={18} width="55%" />
            <Skeleton height={13} width="85%" />
            <Skeleton height={13} width="40%" />
          </View>
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
 * At zero it is a single wide "ADD" -- white, brand-outlined, lifted -- so the common
 * case is one tap and the button reads as the one thing to press on the row. Once there
 * is a quantity it becomes − n + in the same footprint, filled with the brand, so the
 * row never reflows and the next item does not jump out from under a finger. The count
 * is tabular and fixed width, so 9 → 10 does not shove the buttons sideways.
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
  const shape = {
    minHeight: 38,
    minWidth: 96,
    borderRadius: t.radius.sm,
  };

  if (quantity === 0) {
    return (
      <Pressable
        onPress={onAdd}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${addLabel} ${accessibilityName}`}
        accessibilityState={{ disabled }}
        style={(state) => {
          const { pressed, hovered } = state as InteractionState;
          return [
            {
              ...shape,
              paddingHorizontal: t.space.lg,
              borderWidth: 1.5,
              borderColor: disabled ? t.color.border : t.color.primary,
              backgroundColor: disabled
                ? t.color.surfaceAlt
                : hovered
                  ? t.color.primarySoft
                  : t.color.surface,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: pressed ? 0.95 : 1 }],
            },
            disabled ? null : t.elevation.card,
            webInteractive(t.motion.instant),
          ];
        }}
      >
        <Text
          style={[
            t.font.label,
            {
              color: disabled ? t.color.textFaint : t.color.primary,
              fontWeight: '800',
              letterSpacing: 0.6,
            },
          ]}
        >
          {addLabel.toUpperCase()}
        </Text>
      </Pressable>
    );
  }

  const step = (glyph: string, label: string, onPress: () => void, stepDisabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={stepDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          paddingHorizontal: t.space.md,
          height: 38,
          justifyContent: 'center',
          opacity: stepDisabled ? 0.4 : pressed ? 0.6 : 1,
        },
        webInteractive(t.motion.instant),
      ]}
    >
      <Text style={{ color: t.color.onPrimary, fontSize: 18, fontWeight: '800' }}>{glyph}</Text>
    </Pressable>
  );

  return (
    <View
      style={[
        {
          ...shape,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: t.color.primary,
          overflow: 'hidden',
        },
        t.elevation.card,
      ]}
    >
      {step('−', `Remove one ${accessibilityName}`, onRemove)}
      <Text
        accessibilityLabel={`${quantity} in cart`}
        style={[
          t.font.label,
          {
            flex: 1,
            textAlign: 'center',
            color: t.color.onPrimary,
            fontWeight: '800',
            fontVariant: ['tabular-nums'],
          },
        ]}
      >
        {quantity}
      </Text>
      {step('+', `Add one more ${accessibilityName}`, onAdd, disabled)}
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
 * `fallback="initial"` opts into a tinted monogram for places where the absence would
 * look like a rendering fault rather than a design -- a canteen card, say, rather than
 * a dense menu row. The tint is derived from the name so a given canteen is the same
 * colour on every render; a list that reshuffles its colours as it refetches looks
 * broken.
 */
const THUMB_TINTS = [
  ['primaryTint', 'primary'],
  ['successSoft', 'success'],
  ['infoSoft', 'info'],
  ['warningSoft', 'warning'],
] as const;

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
  const [bg, fg] = THUMB_TINTS[hash % THUMB_TINTS.length] ?? THUMB_TINTS[0];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: t.radius.md,
        backgroundColor: t.color[bg],
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Two soft discs behind the letter, so the tile reads as a designed cover and
       * not as a missing image. Pure decoration, sized from the tile. */}
      <View
        style={{
          position: 'absolute',
          width: size * 0.9,
          height: size * 0.9,
          borderRadius: size,
          top: -size * 0.35,
          right: -size * 0.3,
          backgroundColor: t.color[fg],
          opacity: 0.12,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.6,
          height: size * 0.6,
          borderRadius: size,
          bottom: -size * 0.2,
          left: -size * 0.15,
          backgroundColor: t.color[fg],
          opacity: 0.1,
        }}
      />
      <Text
        style={[
          t.font.display,
          { fontSize: size * 0.4, lineHeight: size * 0.5, color: t.color[fg] },
        ]}
      >
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
 * A canteen's rating, as a green pill with the number and a star, and how many people
 * said so beside it.
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
      <View
        accessibilityLabel="Not enough ratings yet"
        style={{
          alignSelf: 'flex-start',
          paddingHorizontal: t.space.sm,
          paddingVertical: t.space.xxs,
          borderRadius: t.radius.sm - 4,
          backgroundColor: t.color.surfaceAlt,
        }}
      >
        <Text style={[t.font.caption, { color: t.color.textMuted, fontWeight: '700' }]}>✦ New</Text>
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
        alignSelf: 'flex-start',
      }}
      accessibilityLabel={`Rated ${average} out of 5 by ${reviews} ${reviews === 1 ? 'person' : 'people'}`}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
          paddingHorizontal: t.space.sm - 2,
          paddingVertical: t.space.xxs,
          borderRadius: t.radius.sm - 4,
          backgroundColor: t.color.successStrong,
        }}
      >
        <Text style={[t.font.caption, { color: t.color.onPrimary, fontWeight: '800' }]}>
          {average.toFixed(1)}
        </Text>
        {/* The star is decoration beside a number that already says it, so it is
         * hidden rather than read out as "black star". */}
        <Text accessibilityElementsHidden style={{ fontSize: 10, color: t.color.onPrimary }}>
          ★
        </Text>
      </View>
      <Text style={[t.font.caption, { color: t.color.textMuted }]}>({reviews})</Text>
    </View>
  );
}

/** A card's own title: an icon in a soft tile, the title, and an optional line under it. */
export function CardTitle({
  icon,
  title,
  subtitle,
  right,
}: {
  icon: IconName;
  title: string;
  subtitle?: string | undefined;
  right?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: t.radius.sm,
          backgroundColor: t.color.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color={t.color.primary} />
      </View>
      <View style={{ flex: 1, gap: t.space.xxs }}>
        <Text style={[t.font.heading, { color: t.color.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[t.font.caption, { color: t.color.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/**
 * One choice of several, as a card with a radio: how to pay, say. Bigger than a chip
 * because each option needs a line of explanation, and a radio because exactly one is
 * always chosen.
 */
export function OptionCard({
  icon,
  title,
  subtitle,
  selected,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle?: string | undefined;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={(state) => {
        const { pressed, hovered } = state as InteractionState;
        return [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.md,
            padding: t.space.md,
            borderRadius: t.radius.md,
            borderWidth: 1.5,
            borderColor: selected ? t.color.primary : hovered ? t.color.textFaint : t.color.border,
            backgroundColor: selected ? t.color.primarySoft : t.color.surface,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
          webInteractive(t.motion.instant),
        ];
      }}
    >
      <Icon name={icon} size={22} color={selected ? t.color.primary : t.color.textMuted} />
      <View style={{ flex: 1, gap: t.space.xxs }}>
        <Text style={[t.font.bodyStrong, { color: t.color.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[t.font.caption, { color: t.color.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: selected ? t.color.primary : t.color.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? (
          <View
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.color.primary }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/** A labelled checkbox row: "Remember this address". */
export function CheckRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={t.hitSlop}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
        webInteractive(t.motion.instant),
      ]}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? t.color.primary : t.color.border,
          backgroundColor: checked ? t.color.primary : t.color.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Icon name="checkmark" size={15} color={t.color.onPrimary} /> : null}
      </View>
      <Text style={[t.font.body, { color: t.color.text }]}>{label}</Text>
    </Pressable>
  );
}
