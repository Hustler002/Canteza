import * as SecureStore from 'expo-secure-store';
import type { SessionStorage } from '@campuseats/api';

/**
 * Session storage backed by the device keychain.
 *
 * SecureStore warns that values over 2048 bytes may fail on Android, and a Supabase
 * session (two JWTs plus user metadata) regularly exceeds that. Storing it whole
 * fails *silently* on some devices, which shows up as users being randomly signed
 * out and is miserable to diagnose. So values are chunked.
 *
 * Chunk 0 holds a small header saying how many chunks follow; a legacy unchunked
 * value is still read correctly, so this can change again without logging anyone out.
 */

const CHUNK_SIZE = 1800; // headroom under the 2048-byte limit
const HEADER = 'ce.chunks:';

const partKey = (key: string, index: number) => `${key}.${index}`;

async function readAll(key: string): Promise<string | null> {
  const head = await SecureStore.getItemAsync(key);
  if (head === null) return null;
  if (!head.startsWith(HEADER)) return head; // stored before chunking, or small

  const count = Number(head.slice(HEADER.length));
  if (!Number.isInteger(count) || count < 1) return null;

  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(partKey(key, i));
    // A missing chunk means a torn write: treat the whole value as absent rather
    // than handing back a truncated JWT that fails in a confusing way later.
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join('');
}

async function clearChunks(key: string): Promise<void> {
  const head = await SecureStore.getItemAsync(key);
  if (!head?.startsWith(HEADER)) return;
  const count = Number(head.slice(HEADER.length));
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(partKey(key, i));
  }
}

export const secureSessionStorage: SessionStorage = {
  async getItem(key) {
    try {
      return await readAll(key);
    } catch {
      // A keychain read can fail after a restore or an OS upgrade. Being signed out
      // is recoverable; crashing on launch is not.
      return null;
    }
  },

  async setItem(key, value) {
    await clearChunks(key);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(
        partKey(key, i),
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
    // Written last, so a crash mid-write leaves no header pointing at partial data.
    await SecureStore.setItemAsync(key, `${HEADER}${count}`);
  },

  async removeItem(key) {
    await clearChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};
