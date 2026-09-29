#!/usr/bin/env node
/**
 * Web app icons, derived from the one app icon.
 *
 * A browser offers "Install" / "Add to Home Screen" only when the web manifest lists a
 * 192px and a 512px icon, and iOS looks for a 180px apple-touch-icon. `assets/icon.png`
 * is the single source for every one of them, so a new logo is one file and one command:
 *
 *   npm run web:icons --workspace @canteza/mobile
 *
 * Uses `@expo/image-utils`, which Expo itself uses to size the native icons, rather than
 * adding an image library for a job that runs once per logo.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateImageAsync } from '@expo/image-utils';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(projectRoot, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const SIZES = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

for (const { file, size } of SIZES) {
  const { source } = await generateImageAsync(
    { projectRoot, cacheType: 'web-icons' },
    {
      src: join(projectRoot, 'assets', 'icon.png'),
      width: size,
      height: size,
      resizeMode: 'contain',
      // Opaque, so iOS does not fill transparency with black on the home screen.
      backgroundColor: '#ffffff',
    },
  );
  writeFileSync(join(outDir, file), source);
  console.log(`wrote public/icons/${file}`);
}
