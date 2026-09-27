import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PUSH_CHANNEL } from '@canteza/shared';
import { routeForPush } from '../src/lib/push-route';

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
