import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { createCampusClient } from '@canteza/api';
import { secureSessionStorage } from './storage';

/**
 * The app's single Supabase client.
 *
 * Only the anon key ships here; everything it can reach is constrained by RLS. The
 * service role key must never appear in a bundle.
 */

const extra = Constants.expoConfig?.extra ?? {};

/**
 * Pick the first usable value, and reject a placeholder.
 *
 * `app.json` carries `$SUPABASE_URL` in `extra` for a build to substitute; an
 * unsubstituted one means the environment was never configured, and passing it on
 * would produce a client pointed at a URL called "$SUPABASE_URL".
 */
function usable(value: unknown, fallback: unknown): string {
  for (const candidate of [value, fallback]) {
    if (typeof candidate === 'string' && candidate !== '' && !candidate.startsWith('$')) {
      return candidate;
    }
  }
  return '';
}

/**
 * **These two reads must stay written out in full.**
 *
 * Expo inlines `EXPO_PUBLIC_*` with a Babel transform that rewrites the literal text
 * `process.env.EXPO_PUBLIC_FOO` into its value at build time. It is a static
 * substitution, not a runtime lookup, so a computed access — `process.env[name]`,
 * which is what this file used to do — is invisible to it and is simply left in the
 * bundle to resolve against nothing.
 *
 * That difference does not show up in development, which is what made it survive:
 * `expo start` injects a populated `process.env` object at runtime, so a dynamic
 * lookup works perfectly on a phone connected to Metro. A production `expo export`
 * ships no such object. The old code therefore read `undefined` for both values in
 * any real build, fell through to the unsubstituted `$SUPABASE_URL` placeholder,
 * and `createCampusClient` threw "Supabase URL and anon key are required" at module
 * load — a release that crashed on launch while every dev build was fine.
 *
 * Verified by grepping the exported Hermes bundle for the project ref: absent
 * before this change, present after it.
 */
const url = usable(process.env.EXPO_PUBLIC_SUPABASE_URL, extra.supabaseUrl);
const anonKey = usable(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, extra.supabaseAnonKey);

export const supabase = createCampusClient({
  url,
  anonKey,
  storage: secureSessionStorage,
  // React Native has no background tab to drive a timer, so refresh is tied to
  // foreground state below instead of running on its own.
  autoRefreshToken: false,
  detectSessionInUrl: false,
});

// Refresh the token while the app is in front, and stop when it is not -- otherwise
// the timer fires in the background and fails without a network.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});

// The listener only hears *changes*. An app opened straight into the foreground -- and
// on the web, a tab that is simply left open and visible -- never changes state, so the
// timer never started. supabase-js still refreshes an expired token before each request,
// which is why this went unnoticed; the realtime socket gets no such rescue.
if (AppState.currentState === 'active') {
  void supabase.auth.startAutoRefresh();
}
