import { Platform, useColorScheme } from 'react-native';

/**
 * Design tokens. Every colour, space and radius in the app comes from here, so the
 * three role experiences look like one product and a restyle is one file.
 *
 * The palette is warm and food-forward rather than the usual SaaS blue: this is a
 * hostel at 1am, not a dashboard. Canteza's saffron stays the one loud colour; the
 * rest is warm stone, so an order button is never competing with the chrome around it.
 *
 * **Separation comes from surface against background, not from outlines.** White cards
 * on a warm grey page, lifted by a soft shadow, is how the food apps students already
 * use read a list at a glance; a hairline border stays only where a shadow cannot be
 * seen (dark mode) or where two whites would otherwise touch.
 */

const palette = {
  saffron600: '#D9480F',
  saffron500: '#E8590C',
  saffron400: '#FF7A2E',
  saffron100: '#FFE4CC',
  saffron50: '#FFF3E8',

  green700: '#1B7A3D',
  green600: '#1F9D55',
  green100: '#E3F6EA',
  red600: '#D63031',
  red100: '#FDECEC',
  blue600: '#2563EB',
  blue100: '#E7EFFE',
  amber600: '#B7791F',
  amber100: '#FEF3DC',

  stone900: '#1C1917',
  stone700: '#44403C',
  stone500: '#6B6560',
  stone400: '#A8A29E',
  stone200: '#E7E2DD',
  stone150: '#EFEBE7',
  stone100: '#F6F4F1',
  white: '#FFFFFF',

  night950: '#0F0D0C',
  night900: '#181514',
  night800: '#221E1C',
  night700: '#2E2926',
  night600: '#3B3532',
  night400: '#8F8983',
  night300: '#A39D97',
  night100: '#F5F2EF',
} as const;

/**
 * The web gets a real typeface; the phone keeps the system one.
 *
 * Plus Jakarta Sans is loaded by `public/index.html` from Google Fonts, which only the
 * browser build reads. On Android and iOS a custom font means bundling files and holding
 * the splash screen until they load -- a rebuild and a startup cost for a gain the
 * system font (Roboto, SF) already mostly gives. `undefined` leaves React Native's own
 * default in place there.
 */
const fontFamily =
  Platform.OS === 'web'
    ? '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    : undefined;

function face<T extends object>(style: T): T & { fontFamily?: string } {
  return fontFamily ? { ...style, fontFamily } : style;
}

export type Theme = ReturnType<typeof buildTheme>;

function buildTheme(dark: boolean) {
  return {
    dark,
    color: {
      /** Actions, focus, the brand. */
      primary: dark ? palette.saffron400 : palette.saffron500,
      /** The pressed / deeper brand, and the brand block behind white text. */
      primaryStrong: dark ? palette.saffron500 : palette.saffron600,
      onPrimary: palette.white,
      /** A translucent white panel on the brand colour: chips on the sign-in hero. */
      onPrimaryVeil: 'rgba(255,255,255,0.16)',
      primarySoft: dark ? '#2B1A10' : palette.saffron50,
      primaryTint: dark ? '#3A2213' : palette.saffron100,

      background: dark ? palette.night950 : palette.stone100,
      surface: dark ? palette.night900 : palette.white,
      surfaceAlt: dark ? palette.night800 : palette.stone150,
      /** Outlines: hairline on cards in dark mode, inputs and dividers everywhere. */
      border: dark ? palette.night600 : palette.stone200,
      /** A card's own outline: invisible in light mode, where the shadow does the work. */
      cardBorder: dark ? palette.night700 : 'transparent',

      text: dark ? palette.night100 : palette.stone900,
      textMuted: dark ? palette.night300 : palette.stone500,
      textFaint: dark ? palette.night600 : palette.stone400,

      success: dark ? '#4ADE80' : palette.green600,
      successStrong: dark ? palette.green600 : palette.green700,
      successSoft: dark ? '#12261A' : palette.green100,
      danger: dark ? '#F87171' : palette.red600,
      dangerSoft: dark ? '#2A1414' : palette.red100,
      info: dark ? '#60A5FA' : palette.blue600,
      infoSoft: dark ? '#121E33' : palette.blue100,
      warning: dark ? '#FBBF24' : palette.amber600,
      warningSoft: dark ? '#2A2110' : palette.amber100,
    },
    /** A 4pt scale. Use these, never a raw number. */
    space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
    radius: { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 },
    font: {
      display: face({
        fontSize: 30,
        fontWeight: '800' as const,
        letterSpacing: -0.8,
        lineHeight: 36,
      }),
      title: face({
        fontSize: 20,
        fontWeight: '800' as const,
        letterSpacing: -0.4,
        lineHeight: 26,
      }),
      heading: face({
        fontSize: 16,
        fontWeight: '700' as const,
        letterSpacing: -0.2,
        lineHeight: 22,
      }),
      /** Section headers above a list: bigger than a heading, so a long page has landmarks. */
      subheading: face({
        fontSize: 18,
        fontWeight: '800' as const,
        letterSpacing: -0.4,
        lineHeight: 24,
      }),
      body: face({ fontSize: 15, fontWeight: '400' as const, lineHeight: 22 }),
      bodyStrong: face({ fontSize: 15, fontWeight: '600' as const, lineHeight: 22 }),
      label: face({ fontSize: 13, fontWeight: '600' as const, lineHeight: 18 }),
      caption: face({ fontSize: 12, fontWeight: '500' as const, lineHeight: 16 }),
      /** Small capitals over a group: "DELIVERING TO", "BILL DETAILS". */
      overline: face({
        fontSize: 11,
        fontWeight: '700' as const,
        letterSpacing: 0.8,
        lineHeight: 14,
      }),
      /**
       * Money is read, compared and acted on, so it gets its own ramp rather than
       * borrowing body. Tabular figures stop a price list from shivering as digits
       * change width during a quantity change.
       */
      price: face({
        fontSize: 15,
        fontWeight: '700' as const,
        fontVariant: ['tabular-nums' as const],
      }),
      priceLg: face({
        fontSize: 20,
        fontWeight: '800' as const,
        fontVariant: ['tabular-nums' as const],
      }),
    },
    /**
     * Elevation, as a pair because the two platforms disagree: iOS and the web read the
     * shadow properties, Android reads `elevation`, so both are set and each platform
     * ignores the other's. `card` is the resting state of every surface; `lifted` is a
     * card under a pointer or a finger; `raised` is for what floats over content, like a
     * sticky bar. Shadows are warm-tinted, not black, so they read as depth on the stone
     * background instead of as dirt.
     */
    elevation: {
      card: {
        shadowColor: dark ? '#000' : '#3B2A1E',
        shadowOpacity: dark ? 0.45 : 0.07,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      },
      lifted: {
        shadowColor: dark ? '#000' : '#3B2A1E',
        shadowOpacity: dark ? 0.55 : 0.12,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 10 },
        elevation: 6,
      },
      raised: {
        shadowColor: dark ? '#000' : '#3B2A1E',
        shadowOpacity: dark ? 0.6 : 0.1,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: -4 },
        elevation: 12,
      },
    },
    /**
     * Motion exists to confirm an action landed, never to make you wait for it.
     * `instant` is a press; `quick` is a layout settling; `enter` is a list arriving.
     * Nothing here is longer, and all of it is skipped when the device asks for less.
     */
    motion: { instant: 90, quick: 180, enter: 260, stagger: 40 },
    /**
     * How wide content may grow on a big screen. The phone never reaches these; a laptop
     * does, and a 1400px-wide menu row is unreadable. `content` is a reading column,
     * `wide` a browsing grid.
     */
    layout: { content: 720, wide: 1080, gridBreakpoint: 760 },
    /** Canteen and delivery screens are used one-handed, often in a hurry. */
    hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
    minTouchTarget: 48,
  };
}

export const lightTheme = buildTheme(false);
export const darkTheme = buildTheme(true);

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme;
}
