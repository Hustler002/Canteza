import { Sentry } from './sentry';

/**
 * Entries in the development build's shake menu for proving Sentry end to end.
 *
 * Development builds only: `__DEV__` is false in a release, the bundler drops this whole
 * branch, and `expo-dev-menu` -- part of `expo-dev-client`, which a release does not
 * contain -- is never loaded. Registering fails quietly in Expo Go or an older build.
 *
 * `expo-dev-menu` is deliberately **not** in package.json: expo-doctor refuses it there,
 * because `expo-dev-client` owns its version. It resolves through that dependency.
 *
 * Kept rather than deleted after the first test: "is Sentry still receiving?" is a
 * question worth one shake to answer after any upgrade, not a code change.
 */
export function registerDevTools(): void {
  if (!__DEV__) return;

  void import('expo-dev-menu')
    .then(({ registerDevMenuItems }) =>
      registerDevMenuItems([
        {
          name: 'Sentry: send a test error',
          callback: () => {
            Sentry.captureException(new Error(`Canteza Sentry test ${new Date().toISOString()}`));
          },
          shouldCollapse: true,
        },
        {
          name: 'Sentry: crash the app (native)',
          // A real native crash: the app closes, and the event is sent on the next launch.
          callback: () => Sentry.nativeCrash(),
          shouldCollapse: true,
        },
      ]),
    )
    .catch(() => undefined);
}
