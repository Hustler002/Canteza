import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BRAND, LOGO, logoCapCentres, logoWeights } from '@canteza/shared';
import { useTheme, type Theme } from '../theme';
import { Badge } from './ui';

/**
 * The Canteza mark, drawn from Views so it is sharp at any size, follows the theme, and
 * needs no image files and no SVG module (`react-native-svg` would mean a native rebuild).
 * The geometry is `LOGO` in `packages/shared/src/logo.ts`, the same numbers the icon files
 * are rendered from.
 *
 * How a ring becomes a C without a vector path: a bordered circle is the plate; a square
 * turned 45°, with one corner on the plate's centre, covers exactly the 90° opening in the
 * background colour; two small circles are the round ends, and they sit precisely where
 * the square's edges cross the ring, so no seam shows. The dot is drawn last. It needs to
 * know what it is drawn on (`background`), which is why it is only ever drawn on a tile.
 */

type Tone = 'brand' | 'reversed' | 'mono';

/**
 * Colours per tone, from the theme (rule 14) — the brand sheet's colours are already its
 * tokens: saffron is `primary` (brighter in dark mode, as the sheet asks), and the dark
 * tile is `surfaceAlt`. `LOGO.colors` is for files rendered outside the app.
 */
function toneColors(t: Theme, tone: Tone): { tile: string; glyph: string } {
  // Reversed sits on a saffron panel, so its glyph is that same saffron.
  if (tone === 'reversed') return { tile: t.color.onPrimary, glyph: t.color.primary };
  if (tone === 'mono') return { tile: t.color.surfaceAlt, glyph: t.color.text };
  return t.dark
    ? { tile: t.color.surfaceAlt, glyph: t.color.primary }
    : { tile: t.color.primary, glyph: t.color.onPrimary };
}

/** The plate and the room, in a `size` × `size` box laid over a solid `background`. */
function Glyph({ size, color, background }: { size: number; color: string; background: string }) {
  const s = size / LOGO.unit;
  const { stroke, dotR } = logoWeights(size);
  const { cx, cy, radius } = LOGO.ring;
  const outer = radius + stroke / 2;
  const { upper, lower } = logoCapCentres();
  // The masking square: its left corner on the centre, each edge longer than the ring.
  const side = outer * 1.3;
  const half = side / Math.SQRT2;
  const circle = (x: number, y: number, r: number, fill: string) => (
    <View
      style={{
        position: 'absolute',
        left: (x - r) * s,
        top: (y - r) * s,
        width: 2 * r * s,
        height: 2 * r * s,
        borderRadius: r * s,
        backgroundColor: fill,
      }}
    />
  );

  return (
    <>
      <View
        style={{
          position: 'absolute',
          left: (cx - outer) * s,
          top: (cy - outer) * s,
          width: 2 * outer * s,
          height: 2 * outer * s,
          borderRadius: outer * s,
          borderWidth: stroke * s,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: (cx + half - side / 2) * s,
          top: (cy - side / 2) * s,
          width: side * s,
          height: side * s,
          backgroundColor: background,
          transform: [{ rotate: '45deg' }],
        }}
      />
      {circle(upper[0], upper[1], stroke / 2, color)}
      {circle(lower[0], lower[1], stroke / 2, color)}
      {circle(LOGO.dot.cx, LOGO.dot.cy, dotR, color)}
    </>
  );
}

/**
 * The mark on its tile. `brand` is saffron (or the dark-mode tile); `reversed` is the white
 * tile for a saffron background; `mono` is one colour for quiet places.
 */
export function LogoMark({
  size = 40,
  tone = 'brand',
  style,
}: {
  size?: number;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const { tile, glyph } = toneColors(t, tone);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: (LOGO.tileRadius / LOGO.unit) * size,
          backgroundColor: tile,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Glyph size={size} color={glyph} background={tile} />
    </View>
  );
}

/**
 * The lockup: mark and name. `horizontal` for bars and headers, `stacked` for a splash or a
 * sign-in. The name is always `BRAND.name` (rule 16), set in the display face.
 */
export function Logo({
  size = 36,
  layout = 'horizontal',
  tone = 'brand',
}: {
  size?: number;
  layout?: 'horizontal' | 'stacked';
  tone?: Tone;
}) {
  const t = useTheme();
  const nameColor = tone === 'reversed' ? t.color.onPrimary : t.color.text;
  const horizontal = layout === 'horizontal';
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={BRAND.name}
      style={{
        flexDirection: horizontal ? 'row' : 'column',
        alignItems: 'center',
        gap: size * (horizontal ? 0.3 : 0.28),
      }}
    >
      <LogoMark size={size} tone={tone} />
      <Text
        style={[
          t.font.display,
          {
            color: nameColor,
            fontSize: size * (horizontal ? 0.64 : 0.5),
            lineHeight: size * (horizontal ? 0.8 : 0.64),
            letterSpacing: -size * 0.02,
          },
        ]}
      >
        {BRAND.name}
      </Text>
    </View>
  );
}

/**
 * The brand bar: the horizontal lockup on the left, the screen's own actions on the right
 * -- the brand sheet's nav bar. It opens each role's first screen (student Home, the
 * counter's board and menu, the delivery queue); screens further in carry a back button
 * instead. `role` tags the lockup, like the admin's ADMIN badge, so a phone shared at a
 * counter says at a glance which app is open.
 */
export function BrandBar({ role, right }: { role?: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
      {/* minWidth 0 and wrap: on a 320px phone the tag drops under the name, never under the buttons. */}
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: t.space.sm,
          rowGap: t.space.xs,
        }}
      >
        <Logo size={34} />
        {role ? (
          // Badge sizes itself with alignSelf; the wrapper is what the row centres.
          <View>
            <Badge label={role} tone="primary" />
          </View>
        ) : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', gap: t.space.sm }}>{right}</View> : null}
    </View>
  );
}
