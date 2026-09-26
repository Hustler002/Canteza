import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the one mistake that only breaks in production.
 *
 * Expo inlines `EXPO_PUBLIC_*` with a Babel transform that rewrites the literal text
 * `process.env.EXPO_PUBLIC_FOO` into its value at build time. It is a static
 * substitution, so a computed access — `process.env[name]` — is invisible to it.
 *
 * The trap is that a computed access works perfectly in development, because
 * `expo start` injects a populated `process.env` object at runtime. A production
 * `expo export` ships no such object, so the same code reads `undefined` and the app
 * launches with no Supabase credentials and throws before the first screen. This
 * codebase shipped exactly that for a while, and no test, typecheck or lint run could
 * see it — the source is valid either way and the difference lives in the bundler.
 *
 * So the invariant is pinned on the source text instead, which is cheap and catches
 * the specific error. The real proof stays a bundle grep: export for Android and look
 * for the project ref, which was absent before the fix and present after it.
 */

// `fileURLToPath` on the string rather than on `new URL(...)`: this package's tsconfig
// includes the DOM lib, whose `URL` is a different type from Node's and does not
// satisfy the overload.
const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEARCHED = ['src', 'app'];

/** Every .ts/.tsx file under the searched directories. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/** Strip comments, so prose *about* the rule does not trip the rule. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('environment variables reach the production bundle', () => {
  const files = SEARCHED.flatMap((dir) => sourceFiles(join(MOBILE_ROOT, dir)));

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never reads process.env with a computed key', () => {
    const offenders = files.filter((file) =>
      /process\.env\s*\[/.test(code(readFileSync(file, 'utf8'))),
    );

    expect(
      offenders.map((file) => file.slice(MOBILE_ROOT.length)),
      'A computed process.env access is silently dropped from a production bundle. ' +
        'Write the variable out in full: process.env.EXPO_PUBLIC_SUPABASE_URL',
    ).toEqual([]);
  });

  it('reads both Supabase variables by their literal names, so Expo can inline them', () => {
    const client = code(readFileSync(join(MOBILE_ROOT, 'src/lib/supabase.ts'), 'utf8'));

    expect(client).toContain('process.env.EXPO_PUBLIC_SUPABASE_URL');
    expect(client).toContain('process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY');
  });
});
