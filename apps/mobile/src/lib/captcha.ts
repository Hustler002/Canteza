/**
 * Cloudflare Turnstile, the CAPTCHA GoTrue checks on sign-in and sign-up once "Enable
 * CAPTCHA protection" is switched on in the Supabase dashboard.
 *
 * **The site key is public** (it is in every page Turnstile protects); the secret lives
 * only in the Supabase dashboard. With no site key configured the widget is not shown and
 * no token is sent, which is exactly right while the dashboard switch is off — so the
 * order of rollout is: site key in the builds first, deploy, see the widget, then the
 * switch. The other way round locks everyone out.
 *
 * Written out in full, never `process.env[name]`: Expo inlines `EXPO_PUBLIC_*` by
 * rewriting this literal text at build time (see `test/env-inlining.test.ts`).
 */
export const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '';

export const captchaRequired = TURNSTILE_SITE_KEY.length > 0;

/**
 * The page the phone's WebView pretends to be. Turnstile only issues tokens on hostnames
 * listed on the widget, and a WebView loading inline HTML has no hostname of its own, so
 * it borrows the web app's. That hostname must stay in the widget's allowed list.
 */
export const TURNSTILE_WEBVIEW_ORIGIN = 'https://canteza-mobile.vercel.app';

export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/** What the WebView page posts back to the app. */
export type TurnstileMessage =
  { type: 'token'; token: string } | { type: 'expired' } | { type: 'error'; code: string };

export function parseTurnstileMessage(raw: string): TurnstileMessage | null {
  try {
    const value = JSON.parse(raw) as Partial<TurnstileMessage> & {
      token?: unknown;
      code?: unknown;
    };
    if (value.type === 'token' && typeof value.token === 'string' && value.token) {
      return { type: 'token', token: value.token };
    }
    if (value.type === 'expired') return { type: 'expired' };
    if (value.type === 'error') return { type: 'error', code: String(value.code ?? '') };
  } catch {
    // Not ours: a WebView can receive messages from any script on the page.
  }
  return null;
}

/**
 * The page the phone renders. Minimal, and built from a site key and a theme only — both
 * values come from our own build, never from user input, and the key is JSON-encoded
 * into the script so no character in it can break out of the string.
 */
export function turnstileHtml(siteKey: string, theme: 'light' | 'dark'): string {
  const background = theme === 'dark' ? '#181514' : '#ffffff';
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;padding:0;background:${background};}#w{display:flex;justify-content:center;}</style>
<script src="${TURNSTILE_SCRIPT}?onload=start&render=explicit" async defer></script>
</head><body><div id="w"></div>
<script>
  function send(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
  function start() {
    turnstile.render('#w', {
      sitekey: ${JSON.stringify(siteKey)},
      theme: ${JSON.stringify(theme)},
      size: 'flexible',
      callback: function (token) { send({ type: 'token', token: token }); },
      'expired-callback': function () { send({ type: 'expired' }); },
      'error-callback': function (code) { send({ type: 'error', code: String(code) }); },
    });
  }
</script></body></html>`;
}
