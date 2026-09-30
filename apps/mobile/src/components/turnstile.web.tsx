import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { TURNSTILE_SCRIPT, TURNSTILE_SITE_KEY } from '../lib/captcha';
import { useTheme } from '../theme';

/**
 * Turnstile in the browser: Cloudflare's own script, loaded on first use only — like
 * Razorpay's checkout.js, nobody who never reaches a sign-in form downloads it. The
 * vercel.json CSP allows challenges.cloudflare.com for script and frame.
 *
 * Most people never see a challenge: the widget checks the browser quietly and hands
 * back a token. The parent remounts this (a new `key`) after every attempt, because a
 * token is good for one request.
 */

type TurnstileApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${TURNSTILE_SCRIPT}?render=explicit`;
      script.async = true;
      script.onload = () =>
        window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing'));
      script.onerror = () => {
        loading = null; // let the next mount try again
        reject(new Error('turnstile failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

export function Turnstile({
  onToken,
  onUnavailable,
}: {
  onToken: (token: string | null) => void;
  onUnavailable: () => void;
}) {
  const t = useTheme();
  const host = useRef<View>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        // react-native-web renders a View as a div, and its ref is that element.
        const element = host.current as unknown as HTMLElement | null;
        if (cancelled || !element) return;
        widgetId = api.render(element, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: t.dark ? 'dark' : 'light',
          size: 'flexible',
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => {
            onToken(null);
            return false; // let Turnstile retry on its own
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onUnavailable();
      });
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
    // Rendered once per mount; the parent remounts (a new key) for a fresh token.
  }, []);

  if (failed) {
    return (
      <Text style={[t.font.caption, { color: t.color.danger }]}>
        The security check could not load. If signing in fails, reload the page or turn off anything
        blocking challenges.cloudflare.com.
      </Text>
    );
  }
  return <View ref={host} style={{ minHeight: 65, alignItems: 'center' }} />;
}
