import { useColorScheme } from 'react-native';

/**
 * Design tokens. Every colour, space and radius in the app comes from here, so the
 * three role experiences look like one product and a restyle is one file.
 *
 * The palette is warm and food-forward rather than the usual SaaS blue: this is a
 * hostel at 1am, not a dashboard.
 */

const palette = {
  amber500: '#E8590C',
  amber400: '#F76707',
  amber100: '#FFE8CC',
  amber50: '#FFF4E6',

  green600: '#2B8A3E',
  green100: '#D3F9D8',
  red600: '#C92A2A',
  red100: '#FFE3E3',
  blue600: '#1971C2',
  blue100: '#D0EBFF',

  ink900: '#16120E',
  ink700: '#3E3833',
  ink500: '#6B625A',
  ink300: '#A8A099',
  ink200: '#D9D3CD',
  ink100: '#EFEAE5',
  paper: '#FFFDFB',
  white: '#FFFFFF',

  night900: '#12100E',
  night800: '#1C1917',
  night700: '#2A2724',
  night600: '#3D3936',
  night300: '#8E8781',
  night100: '#E8E4E0',
} as const;

export type Theme = ReturnType<typeof buildTheme>;

function buildTheme(dark: boolean) {
  return {
    dark,
    color: {
      /** Actions, focus, the brand. */
      primary: dark ? palette.amber400 : palette.amber500,
      onPrimary: palette.white,
      primarySoft: dark ? palette.night700 : palette.amber50,

      background: dark ? palette.night900 : palette.paper,
      surface: dark ? palette.night800 : palette.white,
      surfaceAlt: dark ? palette.night700 : palette.ink100,
      border: dark ? palette.night600 : palette.ink200,

      text: dark ? palette.night100 : palette.ink900,
      textMuted: dark ? palette.night300 : palette.ink500,
      textFaint: dark ? palette.night600 : palette.ink300,

      success: dark ? '#51CF66' : palette.green600,
      successSoft: dark ? palette.night700 : palette.green100,
      danger: dark ? '#FF6B6B' : palette.red600,
      dangerSoft: dark ? palette.night700 : palette.red100,
      info: dark ? '#4DABF7' : palette.blue600,
      infoSoft: dark ? palette.night700 : palette.blue100,
    },
    /** A 4pt scale. Use these, never a raw number. */
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
    radius: { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 },
    font: {
      display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
      title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
      heading: { fontSize: 17, fontWeight: '600' as const },
      /** Section headers above a list: smaller than a heading, louder than a label. */
      subheading: { fontSize: 15, fontWeight: '700' as const, letterSpacing: -0.1 },
      body: { fontSize: 15, fontWeight: '400' as const },
      label: { fontSize: 13, fontWeight: '600' as const },
      caption: { fontSize: 12, fontWeight: '400' as const },
      /**
       * Money is read, compared and acted on, so it gets its own ramp rather than
       * borrowing body. Tabular figures stop a price list from shivering as digits
       * change width during a quantity change.
       */
      price: { fontSize: 15, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
      priceLg: { fontSize: 19, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    },
    /**
     * Elevation, as a pair because the two platforms disagree: iOS reads the shadow
     * properties and Android reads `elevation`, so both are set and each platform
     * ignores the other's. `card` is the resting state of every surface; `raised` is
     * for things that float over content, like a sticky bar or a sheet.
     */
    elevation: {
      card: {
        shadowColor: '#000',
        shadowOpacity: dark ? 0.4 : 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      },
      raised: {
        shadowColor: '#000',
        shadowOpacity: dark ? 0.55 : 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -2 },
        elevation: 12,
      },
    },
    /**
     * Motion exists to confirm an action landed, never to make you wait for it.
     * `instant` is a press; `quick` is a layout settling. Nothing here is longer.
     */
    motion: { instant: 90, quick: 180 },
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
