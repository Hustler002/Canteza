import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The dashboard's colours are a copy of the app's (`globals.css` says so), and the copy
 * drifted: the app's 2026-09-29 refresh moved to warm stone and a brighter dark saffron,
 * and the dashboard kept the old values for a day. This reads both files as text --
 * theme.ts imports react-native, which does not load under Node -- and fails when a
 * token differs.
 */

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

const theme = read('mobile/src/theme.ts');
const css = read('admin/src/app/globals.css');

// `saffron500: '#E8590C',` in the palette.
const palette = Object.fromEntries(
  [...theme.matchAll(/^\s+(\w+): '(#[0-9A-Fa-f]{6})',$/gm)].map((m) => [
    m[1]!,
    m[2]!.toLowerCase(),
  ]),
);
const value = (token: string) =>
  token.startsWith('palette.')
    ? palette[token.slice('palette.'.length)]
    : token.slice(1, -1).toLowerCase();

/** `primary: dark ? palette.saffron400 : palette.saffron500,` or `onPrimary: palette.white,` */
function appColour(name: string, dark: boolean): string | undefined {
  const line = new RegExp(`^\\s+${name}: (.+),$`, 'm').exec(theme)?.[1];
  if (!line) return undefined;
  const pair = /^dark \? (\S+) : (\S+)$/.exec(line);
  return value(pair ? pair[dark ? 1 : 2]! : line);
}

function cssBlock(dark: boolean): Record<string, string> {
  const start = dark ? css.indexOf('@media (prefers-color-scheme: dark)') : css.indexOf(':root {');
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+): (#[0-9a-f]{6});/g)].map((m) => [m[1]!, m[2]!]),
  );
}

const camel = (v: string) => v.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

describe('the dashboard uses the app’s colours', () => {
  for (const dark of [false, true]) {
    it(dark ? 'in dark mode' : 'in light mode', () => {
      const tokens = cssBlock(dark);
      expect(Object.keys(tokens).length).toBeGreaterThan(8);
      for (const [cssName, hex] of Object.entries(tokens)) {
        expect({ token: cssName, hex }).toEqual({
          token: cssName,
          hex: appColour(camel(cssName), dark),
        });
      }
    });
  }
});
