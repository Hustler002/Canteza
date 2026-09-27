import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `react-native-razorpay` must only ever be loaded lazily, from `src/lib/razorpay.ts`.
 *
 * Its entry file constructs a `NativeEventEmitter` at module evaluation, which throws on
 * iOS when the native module is absent -- in Expo Go, and in any development build made
 * without the package. A static import anywhere would therefore crash whichever screen
 * imported it, in exactly the builds where "online payment is unavailable" was supposed
 * to be a polite message. Like the env-inlining rule, nothing in typecheck or lint can
 * see this, so it is pinned on the source text.
 */

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPER = join('src', 'lib', 'razorpay.ts');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    // Declarations describe the module; they do not load it.
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const STATIC_IMPORT = /(^|\n)\s*import\s[^;]*?from\s+['"]react-native-razorpay['"]/;
const ANY_REFERENCE = /['"]react-native-razorpay['"]/;

describe('the Razorpay native module is loaded lazily', () => {
  const files = ['src', 'app'].flatMap((dir) => sourceFiles(join(MOBILE_ROOT, dir)));

  it('is never imported statically', () => {
    const offenders = files
      .filter((file) => STATIC_IMPORT.test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(MOBILE_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('is referenced from the wrapper and nowhere else', () => {
    const referencing = files
      .filter((file) => ANY_REFERENCE.test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(MOBILE_ROOT, file));
    expect(referencing).toEqual([WRAPPER]);
  });
});
