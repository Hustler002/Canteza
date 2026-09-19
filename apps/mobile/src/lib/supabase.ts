import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { createCampusClient } from '@campuseats/api';
import { secureSessionStorage } from './storage';

/**
 * The app's single Supabase client.
 *
 * Only the anon key ships here; everything it can reach is constrained by RLS. The
 * service role key must never appear in a bundle.
 */

const extra = Constants.expoConfig?.extra ?? {};

function readEnv(name: string, fallback: unknown): string {
  const value = process.env[name] ?? (typeof fallback === 'string' ? fallback : '');
  // app.json carries `$SUPABASE_URL` placeholders for the EAS build to substitute;
  // an unsubstituted one means the environment was never configured.
  return value.startsWith('$') ? '' : value;
}

const url = readEnv('EXPO_PUBLIC_SUPABASE_URL', extra.supabaseUrl);
const anonKey = readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', extra.supabaseAnonKey);

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
