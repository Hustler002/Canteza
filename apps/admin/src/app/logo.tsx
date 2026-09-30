import { Plus_Jakarta_Sans } from 'next/font/google';
import { BRAND, LOGO, logoCapCentres, logoWeights } from '@canteza/shared';

/**
 * The Canteza mark and lockup for the dashboard, drawn as inline SVG from `LOGO` in
 * `packages/shared/src/logo.ts` — the same numbers the phone draws with Views and the icon
 * files are rendered from. The tile follows the colour scheme through CSS variables
 * (`.logo-tile`, `.logo-glyph` in globals.css): saffron in light, the brighter saffron on a
 * dark tile in dark, as the brand sheet asks.
 *
 * The name is set in Plus Jakarta Sans, the web app's face, self-hosted by `next/font`
 * at build time — so no request to Google from an admin's browser.
 */
const wordmark = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['800'], display: 'swap' });

export function LogoMark({ size = 40 }: { size?: number }) {
  const { stroke, dotR } = logoWeights(size);
  const { upper, lower } = logoCapCentres();
  const r = LOGO.ring.radius;
  return (
    <svg
      viewBox={`0 0 ${LOGO.unit} ${LOGO.unit}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect className="logo-tile" width={LOGO.unit} height={LOGO.unit} rx={LOGO.tileRadius} />
      <path
        className="logo-glyph"
        d={`M ${upper[0]} ${upper[1]} A ${r} ${r} 0 1 0 ${lower[0]} ${lower[1]}`}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <circle className="logo-dot" cx={LOGO.dot.cx} cy={LOGO.dot.cy} r={dotR} />
    </svg>
  );
}

/** Mark and name. `horizontal` for the top bar, `stacked` for the sign-in page. */
export function Logo({
  size = 40,
  layout = 'horizontal',
  as: Tag = 'span',
}: {
  size?: number;
  layout?: 'horizontal' | 'stacked';
  /** `h1` where the lockup is the page's heading. */
  as?: 'span' | 'h1';
}) {
  const horizontal = layout === 'horizontal';
  return (
    <Tag
      className={`logo ${wordmark.className}`}
      style={{
        flexDirection: horizontal ? 'row' : 'column',
        gap: size * (horizontal ? 0.3 : 0.28),
        fontSize: size * (horizontal ? 0.64 : 0.5),
      }}
    >
      <LogoMark size={size} />
      <span>{BRAND.name}</span>
    </Tag>
  );
}
