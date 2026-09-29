import type { SessionStorage } from '@canteza/api';

/**
 * Session storage for the web build, picked over `storage.ts` by Metro's `.web.ts`
 * resolution, so the phone keeps its keychain and `supabase.ts` does not change.
 *
 * `expo-secure-store` has no web implementation -- its web module is an empty object, so
 * every call throws and no one could stay signed in. The browser's `localStorage` is what
 * supabase-js itself uses on the web. It is readable by any script running on this origin,
 * which is the standard trade for a browser session; the defence is serving no third-party
 * script from the app's own origin, not a different box to put the token in.
 *
 * No chunking: the 2048-byte limit that makes `storage.ts` split values is a keychain
 * limit, and `localStorage` has none that a session comes near.
 *
 * Every call is wrapped: storage throws in some private-browsing modes and when the user
 * has blocked site data, and a sign-in that cannot be remembered must still work for the
 * tab it happened in rather than crash the app.
 */
export const secureSessionStorage: SessionStorage = {
  getItem(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },

  setItem(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Blocked or full: this tab stays signed in, the next one will ask again.
    }
  },

  removeItem(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // nothing stored, nothing to remove
    }
  },
};
