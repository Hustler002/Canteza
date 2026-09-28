import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signOutConsequence } from '../src/lib/sign-out';

/**
 * Every sign-out asks first, and says what it costs.
 *
 * Found on the device: the student's button asked, the counter's signed out on one stray
 * tap. Each screen had wired its own, so they drifted. There is one `useConfirmSignOut`
 * now, and this pins on the source that no screen goes around it.
 */

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESSION = join('src', 'lib', 'session.tsx');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

describe('signing out', () => {
  it('is only ever reached through useConfirmSignOut', () => {
    const files = ['src', 'app'].flatMap((dir) => sourceFiles(join(MOBILE_ROOT, dir)));
    const offenders = files
      .filter((file) => relative(MOBILE_ROOT, file) !== SESSION)
      .filter((file) => /\bsignOut\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(MOBILE_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('tells a student about their cart only when there is one', () => {
    expect(signOutConsequence('student', 2)).toMatch(/cart will be emptied/);
    expect(signOutConsequence('student', 0)).not.toMatch(/cart/);
  });

  it('tells the counter it will stop getting new-order alerts', () => {
    expect(signOutConsequence('canteen', 0)).toMatch(/new-order alerts/);
  });

  it('tells a delivery partner that signing out does not end their shift', () => {
    expect(signOutConsequence('delivery', 0)).toMatch(/does not end your shift/);
  });
});
