import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTurnstileMessage, turnstileHtml } from '../src/lib/captcha';

/**
 * The Turnstile CAPTCHA: what the phone's WebView page says, what the app believes of the
 * messages it gets back, the rule that keeps a build without the WebView module from
 * crashing, and the CSP entries without which the browser would block the widget.
 */

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('react-native-webview is loaded lazily', () => {
  // Its TurboModule is fetched with getEnforcing at import, which throws in any build
  // compiled before the package was added -- every development build made before today.
  const files = ['src', 'app'].flatMap((dir) => sourceFiles(join(MOBILE_ROOT, dir)));

  it('is never imported statically', () => {
    const offenders = files.filter((file) =>
      /(^|\n)\s*import\s[^;]*?from\s+['"]react-native-webview['"]/.test(
        code(readFileSync(file, 'utf8')),
      ),
    );
    expect(offenders.map((f) => relative(MOBILE_ROOT, f))).toEqual([]);
  });

  it('is referenced by the phone widget alone', () => {
    const users = files.filter((file) =>
      /['"]react-native-webview['"]/.test(code(readFileSync(file, 'utf8'))),
    );
    expect(users.map((f) => relative(MOBILE_ROOT, f).replace(/\\/g, '/'))).toEqual([
      'src/components/turnstile.tsx',
    ]);
  });
});

describe('parseTurnstileMessage', () => {
  it('takes a token, an expiry and an error', () => {
    expect(parseTurnstileMessage('{"type":"token","token":"abc"}')).toEqual({
      type: 'token',
      token: 'abc',
    });
    expect(parseTurnstileMessage('{"type":"expired"}')).toEqual({ type: 'expired' });
    expect(parseTurnstileMessage('{"type":"error","code":300030}')).toEqual({
      type: 'error',
      code: '300030',
    });
  });

  it('ignores anything else a page could post', () => {
    for (const raw of [
      'not json',
      '{}',
      '{"type":"token"}',
      '{"type":"token","token":""}',
      'null',
    ]) {
      expect(parseTurnstileMessage(raw)).toBeNull();
    }
  });
});

describe('turnstileHtml', () => {
  it('renders the site key as a JSON string, so no character in it can escape the script', () => {
    const html = turnstileHtml('0x4AAA"</script><script>alert(1)//', 'light');
    expect(html).toContain('sitekey: "0x4AAA\\"</script><script>alert(1)//"');
    expect(html).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js');
    expect(html).toContain('window.ReactNativeWebView.postMessage');
  });

  it('matches the app theme', () => {
    expect(turnstileHtml('k', 'dark')).toContain('theme: "dark"');
    expect(turnstileHtml('k', 'light')).toContain('theme: "light"');
  });
});

describe('the web CSP lets the widget load', () => {
  const vercel = JSON.parse(readFileSync(join(MOBILE_ROOT, 'vercel.json'), 'utf8')) as {
    headers: { headers: { key: string; value: string }[] }[];
  };
  const csp = vercel.headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === 'Content-Security-Policy')!.value;
  const directive = (name: string) =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `)) ?? '';

  it('allows Cloudflare for the script and the frame it draws', () => {
    expect(directive('script-src')).toContain('https://challenges.cloudflare.com');
    expect(directive('frame-src')).toContain('https://challenges.cloudflare.com');
  });

  it('still allows Razorpay and Supabase, which it was written for', () => {
    expect(directive('script-src')).toContain('https://checkout.razorpay.com');
    expect(directive('frame-src')).toContain('https://api.razorpay.com');
    expect(directive('connect-src')).toMatch(/wss:\/\/\w+\.supabase\.co/);
  });
});
