import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PUSH_CHANNEL } from '@canteza/shared';
import { claimResponse, pushAllowed, routeForPush } from '../src/lib/push-route';

describe('routeForPush', () => {
  it('opens the order itself for a student', () => {
    expect(routeForPush({ audience: 'student', orderId: 'o1' }, 'student')).toBe('/order/o1');
  });

  it('treats an admin on the phone as a student, which is the tree they browse', () => {
    expect(routeForPush({ audience: 'student', orderId: 'o1' }, 'admin')).toBe('/order/o1');
  });

  it('opens the board for the counter and the queue for a partner', () => {
    expect(routeForPush({ audience: 'canteen', orderId: 'o1' }, 'canteen')).toBe('/orders');
    expect(routeForPush({ audience: 'delivery', orderId: 'o1' }, 'delivery')).toBe('/deliveries');
  });

  it('stays put for a notification addressed to a different role than the one signed in', () => {
    // Left in the tray from before an account switch on a shared phone.
    expect(routeForPush({ audience: 'canteen', orderId: 'o1' }, 'student')).toBeNull();
    expect(routeForPush({ audience: 'student', orderId: 'o1' }, 'delivery')).toBeNull();
  });

  it('stays put for anything it does not recognise', () => {
    for (const data of [null, undefined, {}, { audience: 'student' }, { audience: 42 }]) {
      expect(routeForPush(data, 'student')).toBeNull();
    }
  });
});

describe('the Android channel', () => {
  it('is the default channel app.json declares, so a push with no channel still rings', () => {
    // JSON cannot import the constant, so this is where the two are held together.
    const appJson = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app.json'), 'utf8'),
    ) as { expo: { plugins: unknown[] } };
    const plugin = appJson.expo.plugins.find(
      (entry): entry is [string, { defaultChannel?: string }] =>
        Array.isArray(entry) && entry[0] === 'expo-notifications',
    );
    expect(plugin?.[1].defaultChannel).toBe(PUSH_CHANNEL.id);
  });
});

describe('where the build finds google-services.json', () => {
  // app.config.js is CommonJS, read by Expo's own loader; require it the same way.
  const { googleServicesFile } = createRequire(import.meta.url)('../app.config.js') as {
    googleServicesFile: (
      env: Record<string, string>,
      exists: (p: string) => boolean,
    ) => string | undefined;
  };

  it('uses the EAS secret file variable when the build servers set it', () => {
    expect(googleServicesFile({ GOOGLE_SERVICES_JSON: '/eas/file.json' }, () => true)).toBe(
      '/eas/file.json',
    );
  });

  it('falls back to the local file on a developer machine', () => {
    expect(googleServicesFile({}, () => true)).toBe('./google-services.json');
  });

  it('leaves the setting out when there is neither, rather than break the build', () => {
    expect(googleServicesFile({}, () => false)).toBeUndefined();
  });
});

describe('a tapped notification is acted on once per device', () => {
  const store = () => {
    const map = new Map<string, string>();
    return {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => void map.set(key, value),
    };
  };

  it('opens the first time and never again for the same tap', async () => {
    const disk = store();
    expect(await claimResponse('tap-1', disk)).toBe(true);
    // A reload: new runtime, empty memory, and Android replays the same tap.
    expect(await claimResponse('tap-1', disk)).toBe(false);
    expect(await claimResponse('tap-1', disk)).toBe(false);
  });

  it('still opens a different, newer tap', async () => {
    const disk = store();
    await claimResponse('tap-1', disk);
    expect(await claimResponse('tap-2', disk)).toBe(true);
  });

  it('opens rather than swallows the tap when storage fails', async () => {
    const broken = {
      getItem: async () => {
        throw new Error('storage unavailable');
      },
      setItem: async () => undefined,
    };
    expect(await claimResponse('tap-1', broken)).toBe(true);
  });
});

describe('pushAllowed', () => {
  it('trusts status, not granted — notifications switched off in settings', () => {
    // What Android reports when the runtime permission is still held but the user has
    // turned the app's notifications off.
    expect(pushAllowed({ status: 'denied', granted: true })).toBe(false);
  });

  it('allows only a plain grant', () => {
    expect(pushAllowed({ status: 'granted', granted: true })).toBe(true);
    expect(pushAllowed({ status: 'undetermined', granted: false })).toBe(false);
    expect(pushAllowed({ status: 'denied', granted: false })).toBe(false);
  });
});
