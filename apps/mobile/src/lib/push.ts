import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { registerPushToken, unregisterPushToken } from '@canteza/api';
import { PUSH_CHANNEL } from '@canteza/shared';
import { supabase } from './supabase';

/**
 * Push notifications, the device's half.
 *
 * The server half is `send-push`, fired for every row `notify_order` writes. This file
 * does three things: gets permission and a token, tells the server whose device this
 * is, and turns a tapped notification into a screen. It never decides what a
 * notification says -- that arrives already worded, from the same function the inbox
 * uses.
 *
 * **Every failure here is swallowed and logged.** Push is a second delivery of something
 * the inbox already shows. A student who refuses permission, a build without Firebase
 * config, Expo Go (which has no remote push on Android from SDK 53) or an offline start
 * must all leave the app working exactly as before, just without push.
 */

// While the app is open, still show the banner: a counter with the order board on screen
// may be looking at the fryer, not the phone.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** The token this device registered this session, so sign-out can remove exactly it. */
let registeredToken: string | null = null;

function projectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId;
}

/**
 * Ask for permission (once -- Android and iOS both remember a refusal), make sure the
 * channel exists, get the token, and hand it to the server. Returns the token, or null
 * for every reason push is unavailable.
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;

  try {
    if (Platform.OS === 'android') {
      // Before asking for permission: on Android 13+ the system prompt only appears once
      // a channel exists. HIGH is what makes an order update a heads-up banner.
      await Notifications.setNotificationChannelAsync(PUSH_CHANNEL.id, {
        name: PUSH_CHANNEL.name,
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return null;

    const id = projectId();
    if (!id) {
      console.warn('[push] no EAS projectId in app config; push disabled');
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await registerPushToken(supabase, token, Platform.OS);
    registeredToken = token;
    return token;
  } catch (error) {
    // Expected in Expo Go, and in a build made before Firebase was configured.
    console.warn('[push] registration skipped:', (error as Error).message);
    return null;
  }
}

/** Stop this device receiving the signed-in person's pushes. Call before signing out. */
export async function unregisterForPush(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  try {
    await unregisterPushToken(supabase, token);
  } catch (error) {
    // The next person to sign in on this phone takes the token over anyway.
    console.warn('[push] could not unregister:', (error as Error).message);
  }
}

export { routeForPush } from './push-route';
