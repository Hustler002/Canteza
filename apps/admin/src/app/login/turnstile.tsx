'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile on the admin sign-in, the same widget the student app shows.
 *
 * GoTrue checks the token once "Enable CAPTCHA protection" is on in the Supabase
 * dashboard. With no site key configured this renders nothing and the form sends no
 * token, which is right while that switch is off. `NEXT_PUBLIC_*` is inlined at build
 * time, so the key must be set in Vercel before the build that should carry it.
 */

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
export const captchaRequired = TURNSTILE_SITE_KEY.length > 0;

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
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () =>
        window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing'));
      script.onerror = () => {
        loading = null;
        reject(new Error('turnstile failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** Remount (a new `key`) after every attempt: a token is good for one request. */
export function Turnstile({
  onToken,
  onUnavailable,
}: {
  onToken: (token: string | null) => void;
  /** The script could not load: the form then submits without a token and GoTrue decides. */
  onUnavailable: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !host.current) return;
        widgetId = api.render(host.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'auto',
          size: 'flexible',
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => {
            onToken(null);
            return false;
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
    // Rendered once per mount; the form remounts it for a fresh token.
  }, []);

  if (failed) {
    return <p className="error">The security check could not load. Reload the page.</p>;
  }
  return <div ref={host} style={{ minHeight: 65 }} />;
}
