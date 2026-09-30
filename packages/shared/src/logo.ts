/**
 * The Canteza mark, as numbers: the one definition every surface draws from.
 *
 * The C is a plate — a thick ring seen from above, open on the right — and the dot in its
 * opening is the room the order is going to. Saffron on stone: the app's own brand
 * colour, so the logo and the screens are one family.
 *
 * Measured from the 1024 × 1024 master in the brand sheet ("Canteza Logo.pdf"), in the
 * master's own units. The phone draws it from Views (`apps/mobile/src/components/logo.tsx`),
 * the admin from inline SVG, and `apps/mobile/scripts/brand-assets.mjs` renders every
 * icon file from `logoSvg()` — so a change here is one edit and one command, not a
 * redrawing in five places.
 *
 * Deliberately free of TypeScript-only syntax beyond annotations, so Node can run it
 * directly (type stripping) when the asset script imports it.
 */
export const LOGO = {
  /** The master's edge. Every other number is in these units. */
  unit: 1024,
  /** The tile's corner, for surfaces that draw the tile themselves (the OS rounds icons). */
  tileRadius: 236,
  /** The plate: a ring around the tile's centre. */
  ring: { cx: 512, cy: 512, radius: 245.6, stroke: 131.8 },
  /** Half the plate's opening, either side of the rightward horizontal, in degrees. */
  openingHalfAngle: 45,
  /** The room. */
  dot: { cx: 737.2, cy: 512, r: 60.7 },
  /**
   * At 32 px and below the stroke and dot thicken, so the plate does not close up
   * (the brand sheet's own rule for favicons and tab icons).
   */
  smallSize: 32,
  smallBoost: 1.15,
  colors: {
    saffron: '#E8590C',
    /** Dark mode: brighter saffron for contrast, on a near-black tile. */
    saffronBright: '#FF7A2E',
    darkTile: '#221E1C',
    ink: '#1C1917',
    stone: '#F6F4F1',
    white: '#FFFFFF',
    /** One colour: print, stamps, receipts, and Android's themed icons. */
    mono: '#44403C',
  },
} as const;

/** Stroke and dot for a mark drawn `sizePx` wide, thickened at small sizes. */
export function logoWeights(sizePx: number): { stroke: number; dotR: number } {
  const boost = sizePx <= LOGO.smallSize ? LOGO.smallBoost : 1;
  return { stroke: LOGO.ring.stroke * boost, dotR: LOGO.dot.r * boost };
}

/** The two ends of the plate's opening, on the ring's centre line (SVG y-down). */
export function logoCapCentres(): { upper: [number, number]; lower: [number, number] } {
  const a = (LOGO.openingHalfAngle * Math.PI) / 180;
  const dx = LOGO.ring.radius * Math.cos(a);
  const dy = LOGO.ring.radius * Math.sin(a);
  return {
    upper: [LOGO.ring.cx + dx, LOGO.ring.cy - dy],
    lower: [LOGO.ring.cx + dx, LOGO.ring.cy + dy],
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

export type LogoSvgOptions = {
  /** Glyph colour. */
  glyph: string;
  /** Tile colour; omit for the bare glyph on transparency. */
  tile?: string;
  /** `rounded` draws the tile's corners; `square` is for OS icons, which round themselves. */
  shape?: 'rounded' | 'square';
  /** How large the result will be shown, in pixels — thickens the strokes at 32 and below. */
  renderSize?: number;
  /**
   * Scale the glyph about the centre, for Android's adaptive icon: the launcher masks the
   * outer third away, so the glyph must sit inside the middle two thirds.
   */
  glyphScale?: number;
};

/** The mark as a standalone SVG document (a 1024-unit square). */
export function logoSvg(options: LogoSvgOptions): string {
  const { glyph, tile, shape = 'rounded', renderSize = LOGO.unit, glyphScale = 1 } = options;
  const { stroke, dotR } = logoWeights(renderSize);
  const { upper, lower } = logoCapCentres();
  const r = LOGO.ring.radius;
  const tileRect = tile
    ? `<rect width="1024" height="1024"${shape === 'rounded' ? ` rx="${LOGO.tileRadius}"` : ''} fill="${tile}"/>`
    : '';
  const scale =
    glyphScale === 1
      ? ''
      : ` transform="translate(512 512) scale(${glyphScale}) translate(-512 -512)"`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
    tileRect,
    `<g${scale}>`,
    // Around the left, the long way: large-arc 1, counter-clockwise on screen (sweep 0).
    `<path d="M ${round(upper[0])} ${round(upper[1])} A ${r} ${r} 0 1 0 ${round(lower[0])} ${round(lower[1])}" fill="none" stroke="${glyph}" stroke-width="${round(stroke)}" stroke-linecap="round"/>`,
    `<circle cx="${LOGO.dot.cx}" cy="${LOGO.dot.cy}" r="${round(dotR)}" fill="${glyph}"/>`,
    '</g>',
    '</svg>',
  ].join('');
}
