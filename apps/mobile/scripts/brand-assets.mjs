#!/usr/bin/env node
/**
 * Every logo file the apps ship, rendered from the one definition in
 * `packages/shared/src/logo.ts`. A change to the mark is an edit there and:
 *
 *   npm run brand:assets --workspace @canteza/mobile
 *
 * which also regenerates the web manifest icons (`web:icons` reads `assets/icon.png`).
 * The outputs are committed, so a build never runs this.
 *
 * Imports the TypeScript source directly: Node strips the type annotations itself
 * (unflagged from 22.18; the npm script passes the flag for older 22.x).
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { LOGO, logoSvg } from '../../../packages/shared/src/logo.ts';

const mobile = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = join(mobile, '..', 'admin');
const { saffron, white } = LOGO.colors;

/**
 * Android's adaptive icon: the launcher crops the 108dp canvas to a shape of about 72dp,
 * so the glyph is scaled to sit in the middle two thirds, keeping the proportion it has
 * on the square icon.
 */
const ADAPTIVE = 72 / 108;

const PNGS = [
  // The app icon: a full-bleed square. iOS and Android round it themselves.
  {
    file: join(mobile, 'assets/icon.png'),
    size: 1024,
    svg: { glyph: white, tile: saffron, shape: 'square' },
  },
  {
    file: join(mobile, 'assets/android-icon-foreground.png'),
    size: 512,
    svg: { glyph: white, glyphScale: ADAPTIVE },
  },
  {
    file: join(mobile, 'assets/android-icon-background.png'),
    size: 512,
    svg: { glyph: saffron, tile: saffron, shape: 'square' },
  },
  // Themed icons and the notification icon: Android reads only the alpha.
  {
    file: join(mobile, 'assets/android-icon-monochrome.png'),
    size: 432,
    svg: { glyph: white, glyphScale: ADAPTIVE },
  },
  // Browser tab: drawn at 16–32 px, so the thickened strokes.
  {
    file: join(mobile, 'assets/favicon.png'),
    size: 48,
    svg: { glyph: white, tile: saffron, renderSize: 32 },
  },
  // Reversed, on saffron: the splash screen's mark, ready for when the phone gets one.
  {
    file: join(mobile, 'assets/splash-icon.png'),
    size: 1024,
    svg: { glyph: saffron, tile: white },
  },
  // Next's apple-icon convention: iOS rounds it, so a full-bleed square.
  {
    file: join(admin, 'src/app/apple-icon.png'),
    size: 180,
    svg: { glyph: white, tile: saffron, shape: 'square' },
  },
];

const SVGS = [
  {
    file: join(mobile, 'public/favicon.svg'),
    svg: { glyph: white, tile: saffron, renderSize: 32 },
  },
  // Next's icon convention: served at /icon.svg and linked from every page.
  { file: join(admin, 'src/app/icon.svg'), svg: { glyph: white, tile: saffron, renderSize: 32 } },
];

for (const { file, size, svg } of PNGS) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(logoSvg({ renderSize: size, ...svg })))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(`wrote ${file.slice(mobile.length - 'apps/mobile'.length)}`);
}
for (const { file, svg } of SVGS) {
  writeFileSync(file, `${logoSvg(svg)}\n`);
  console.log(`wrote ${file.slice(mobile.length - 'apps/mobile'.length)}`);
}
