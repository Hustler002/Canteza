# The Android development build

Expo Go cannot go any further. Remote push is unavailable in it on Android from SDK 53,
`@sentry/react-native` is a native module, and so is the Razorpay checkout — so the next
three pieces of Phase 8 all need the same thing: a development build.

**A development build bakes in native modules.** Adding one later means building again.
So every native dependency Phase 8 needs goes in _before_ the first build, even the ones
not written yet — an unused native module costs a few hundred kilobytes and nothing else,
while a second 20-minute build cycle costs an evening.

## Already done in this repo

- `android.package` — **was missing entirely**, and an Android build cannot start without
  it. Set to `edu.campus.canteza`. Change it now if you want something else: it is the
  app's permanent identity on a device and on the Play Store, and it cannot be changed
  after the first submission without shipping a different app.
- `eas.json` — `development` (dev client, APK, internal), `preview` (plain APK for
  handing round) and `production` (app bundle).
- `EXPO_PUBLIC_*` in each profile's `env`. **This is required, not convenience.** EAS
  builds on its own servers and `apps/mobile/.env` is gitignored, so it is not uploaded —
  without these the build inlines nothing and the app launches with no credentials, which
  is the exact failure `apps/mobile/test/env-inlining.test.ts` guards against in source.
  Only the publishable key is here; it is already inlined into every bundle by design and
  is constrained by RLS. The service role key appears nowhere near this file.

## The three expo-doctor failures, and what they actually were

`npx expo-doctor` now reports **21/21**. Two of the three had been shrugged off earlier
as deliberate, which was right for Expo Go and wrong the moment a native build entered
the picture — a native build may contain only one copy of a native module.

**Duplicate React.** `apps/admin` asked for `react: ^19.2.0`, which resolved to 19.3.0
and won the hoist, so npm placed a second nested copy of the **19.2.3** that Expo SDK 57
pins for `apps/mobile`. Both workspaces now name that exact version, with an `overrides`
block at the repo root so a future `npm update` cannot drift them apart again. Fixing it
needed the stale hoisted copy deleting by hand — `npm install` alone kept the existing
layout and reported success while changing nothing.

**`resolver.disableHierarchicalLookup` in `metro.config.js`.** This was the mitigation
for that duplicate: stop Metro finding the second React. With one React hoisted there is
nothing to disambiguate, so the override is gone and the config matches
`expo/metro-config` again. The reasoning is written out in the file so it is not
reinstated by reflex.

**Patch mismatches.** `npx expo install --fix` moved `expo`, `expo-router` and
`expo-linking` onto their SDK 57 patches. `@expo/ui` disappeared from the list on its
own — it is a transitive dependency of `expo-router`, never ours, so updating the parent
settled it. It was also declared directly in `apps/mobile` and imported nowhere, so that
declaration is removed.

Verified afterwards: `next build` still compiles and still prints `ƒ Proxy (Middleware)`;
the Android bundle still exports at 3.7MB with the workspace packages and both
credentials inlined, and the service role key still absent.

## What you need to do

### 1. An Expo account

Free. https://expo.dev/signup, then:

```bash
npx eas-cli login
```

### 2. Link the project

From `apps/mobile`. This writes `extra.eas.projectId` into `app.json` — commit it.

```bash
npx eas-cli init
```

### 3. Install the native modules — **done**

`expo-dev-client`, `expo-notifications` and `react-native-razorpay` are installed, and
`expo install --fix` has put everything on its SDK 57 patch. Nothing to do here.

- **`expo-dev-client`** — what makes the build a _development_ build: it loads JS from
  Metro like Expo Go, so the edit/reload loop is unchanged afterwards.
- **`expo-notifications`** — for push. Having it compiled in turned out not to be enough:
  push also needs Firebase's config in the build, so it costs one more build after all.
  See "Push: the second build" below.
- **`react-native-razorpay`** — the checkout. Version 3.0.0, last published 2026-07-21.
  It ships **no Expo config plugin**, so it relies on autolinking; that works for a dev
  build, but if it turns out to need an `AndroidManifest` entry we will have to write a
  small plugin. Flagging it because it is the one dependency here that is not
  Expo-maintained.

Add Sentry in the same pass if you want it in this build (`@sentry/react-native@~7.11.0`);
it needs a DSN before it does anything, but installing it now avoids a third build.

### 4. Build

```bash
npx eas-cli build --profile development --platform android
```

Roughly 10–20 minutes on the free tier. It ends with a QR code and a URL.

### 5. Install it on the phone

Scan the QR, download the APK, allow "install from unknown sources". This replaces Expo
Go for this project — you open **Canteza** rather than Expo Go from now on.

### 6. Run it

```bash
npm run dev:mobile
```

Same Metro server as before; the dev build connects to it the same way. Everything about
the workflow is unchanged except which app you open.

## Razorpay

The native checkout is written (`src/lib/razorpay.ts`, checkout, the order screen).
**It needs no rebuild**: `react-native-razorpay` was installed before this build, so it
is already compiled in. Whether autolinking actually registered it is something only the
phone can say — if it did not, checkout simply offers cash only, because the app asks the
module registry before it ever loads the package.

**Nothing Razorpay-related goes in this app or in `eas.json`.** Not even the key id:
`create-payment` returns it alongside the Razorpay order, so the key that opens the sheet
is always the one whose secret created the order. A key id from test mode with a secret
from live mode is the classic way to get a sheet that opens and then fails.

Deploying the server side — migration, secrets, both functions, the webhook, and the
automatic-capture setting — is in
[`supabase/functions/README.md`](../../supabase/functions/README.md#deploying).

## Push: the second build

Push needs **one more build**. An Expo push token on Android is a Firebase Cloud Messaging
token underneath, and the app can only get one if Firebase's config file is compiled into
it. `expo-notifications` being installed was not enough; the earlier note here that push
would need no rebuild was wrong.

Everything on the app side is written and waiting for that build: `src/lib/push.ts` asks
for permission, creates the `orders` channel, registers the device, and opens the right
screen when a notification is tapped. Until the build has Firebase in it, registration
fails quietly and logs `[push] registration skipped` — the app works exactly as before.

### 1. A Firebase project

Free. https://console.firebase.google.com → Add project (Analytics not needed) → add an
**Android app** with package name **`edu.campus.canteza`** — it must match `app.json`
exactly. Download **`google-services.json`** into `apps/mobile/`.

That file is not a secret (it identifies the app to Firebase and is readable from any
installed APK), so it can be committed — and must be, or at least be present, because EAS
builds from the repo. Tell me when it is there and I will wire `android.googleServicesFile`
into `app.json`; pointing at a file that does not exist yet would break every build.

### 2. Give Expo permission to send through it

Firebase console → Project settings → **Service accounts** → Generate new private key.
This one **is** a secret: never commit it. Upload it to EAS instead:

```bash
npx eas-cli credentials --platform android
```

Choose the development profile → Google Service Account → **Push Notifications (FCM
V1)** → upload the JSON. Expo's push service uses it to talk to Firebase for you.

### 3. Rebuild and reinstall

```bash
npx eas-cli build --profile development --platform android
```

Then install the new APK over the old one. **Reload once it opens** — rule 18a.

On first launch after signing in, Android 13+ asks for notification permission. Allow it.
