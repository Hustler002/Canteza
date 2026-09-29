import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirm, notify } from '../src/lib/dialog.web';

/**
 * Dialogs on the web.
 *
 * react-native-web's `Alert.alert` does nothing, and every destructive action in this app
 * waits on a dialog's button -- so on the web, "Cancel order", "Reject" and "Sign out"
 * opened nothing and did nothing. `dialog.web.ts` answers with the browser's own dialogs,
 * and the guard below keeps any screen from calling `Alert` directly again.
 */

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIALOG = join('src', 'lib', 'dialog.ts');

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

const options = (over = {}) => ({
  title: 'Reject this order?',
  message: '#101 will be cancelled.',
  confirmLabel: 'Reject',
  cancelLabel: 'Keep it',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('confirm on the web', () => {
  it('acts when the person says OK, and says what OK means', () => {
    const browserConfirm = vi.fn((_question: string) => true);
    vi.stubGlobal('confirm', browserConfirm);
    const o = options();
    confirm(o);

    expect(o.onConfirm).toHaveBeenCalledOnce();
    expect(o.onCancel).not.toHaveBeenCalled();
    const question = browserConfirm.mock.calls[0]?.[0] ?? '';
    expect(question).toContain('Reject this order?');
    expect(question).toContain('OK: Reject');
    expect(question).toContain('Cancel: Keep it');
  });

  it('does nothing but clean up when the person cancels', () => {
    vi.stubGlobal('confirm', () => false);
    const o = options();
    confirm(o);
    expect(o.onConfirm).not.toHaveBeenCalled();
    expect(o.onCancel).toHaveBeenCalledOnce();
  });

  it('treats a browser with no dialog as a cancel, never a yes', () => {
    vi.stubGlobal('confirm', undefined);
    const o = options();
    confirm(o);
    expect(o.onConfirm).not.toHaveBeenCalled();
  });
});

describe('notify on the web', () => {
  it('shows the title and the message', () => {
    const browserAlert = vi.fn();
    vi.stubGlobal('alert', browserAlert);
    notify('Could not cancel', 'The canteen already accepted it.');
    expect(browserAlert).toHaveBeenCalledWith(
      'Could not cancel\n\nThe canteen already accepted it.',
    );
  });
});

describe('Alert', () => {
  it('is called from dialog.ts and nowhere else', () => {
    const offenders = ['src', 'app']
      .flatMap((dir) => sourceFiles(join(MOBILE_ROOT, dir)))
      .filter((file) => relative(MOBILE_ROOT, file) !== DIALOG)
      .filter((file) => /\bAlert\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(MOBILE_ROOT, file));
    expect(offenders).toEqual([]);
  });
});
