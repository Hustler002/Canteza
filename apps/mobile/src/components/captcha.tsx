import { useCallback, useState } from 'react';
import { captchaRequired } from '../lib/captcha';
import { Turnstile } from './turnstile';

/**
 * The CAPTCHA a sign-in or sign-up form carries, as one hook so both screens behave the
 * same way.
 *
 * - `ready` is true when the form may submit: always when no site key is configured,
 *   otherwise only once Turnstile has handed back a token.
 * - If the widget cannot run at all -- a phone build from before the WebView module, or a
 *   browser blocking Cloudflare -- the form submits without a token and GoTrue decides:
 *   fine while CAPTCHA protection is off, `CAPTCHA_FAILED` once it is on. Holding the
 *   button would lock such a person out even while nothing is enforcing the check.
 * - `reset()` must be called after every attempt, whatever its outcome. A token is good
 *   for one request, so the widget is remounted (a new `key`) to fetch the next one.
 *
 * Metro picks `turnstile.web.tsx` in the browser and `turnstile.tsx` on the phone.
 */
export function useCaptcha() {
  const [token, setToken] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const markUnavailable = useCallback(() => setUnavailable(true), []);

  const reset = useCallback(() => {
    setToken(null);
    setGeneration((n) => n + 1);
  }, []);

  const element = captchaRequired ? (
    <Turnstile key={generation} onToken={setToken} onUnavailable={markUnavailable} />
  ) : null;

  return {
    element,
    token: captchaRequired ? token : null,
    ready: !captchaRequired || unavailable || token !== null,
    reset,
  };
}
