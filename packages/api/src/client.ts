import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@campuseats/shared';

/**
 * One Supabase client factory for both apps.
 *
 * The only thing that differs between mobile and web is where the session is kept:
 * expo-secure-store on a phone, cookies or localStorage in a browser. That is passed
 * in rather than branched on, so this file has no platform code in it.
 */

export type SessionStorage = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
};

export type CampusClientConfig = {
  url: string;
  anonKey: string;
  /** Omit to use the platform default (localStorage in a browser). */
  storage?: SessionStorage | undefined;
  /**
   * React Native has no background tab, so token auto-refresh must be driven by
   * AppState instead. Mobile passes false and calls startAutoRefresh on foreground.
   */
  autoRefreshToken?: boolean | undefined;
  /** Only a browser can pick a session out of the URL after an email link. */
  detectSessionInUrl?: boolean | undefined;
};

export type CampusClient = SupabaseClient<Database>;

export function createCampusClient(config: CampusClientConfig): CampusClient {
  if (!config.url || !config.anonKey) {
    throw new Error('Supabase URL and anon key are required. Copy .env.example and fill it in.');
  }
  // The anon key is safe in a client bundle: everything it can reach is constrained
  // by RLS. The service role key must never appear in an app.
  if (config.anonKey.length > 80 && config.anonKey.includes('service_role')) {
    throw new Error('Refusing to start: that looks like a service role key, not an anon key.');
  }

  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      ...(config.storage ? { storage: config.storage } : {}),
      autoRefreshToken: config.autoRefreshToken ?? true,
      persistSession: true,
      detectSessionInUrl: config.detectSessionInUrl ?? false,
    },
  });
}
