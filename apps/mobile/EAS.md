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
- **`expo-notifications`** — for push. Nothing reads it yet; it is here so push does not
  cost a rebuild.
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

## Razorpay, separately

The checkout also needs a Razorpay account — https://dashboard.razorpay.com/signup.
**Test mode is enough**, and no KYC is needed for test mode.

From the dashboard you will need three things:

| Value          | Where it goes                      | Why                                    |
| -------------- | ---------------------------------- | -------------------------------------- |
| Key ID         | the app (public, safe in a bundle) | opens the checkout sheet               |
| Key secret     | **Edge Function secret only**      | creates orders; never in an app bundle |
| Webhook secret | **Edge Function secret only**      | verifies the webhook signature         |

Then:

```bash
npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=...
```

```bash
npx supabase functions deploy verify-payment
```

And point a webhook at `https://xsekofflcpocxewqzfbx.supabase.co/functions/v1/verify-payment`,
subscribed to `payment.captured` and `payment.failed`.

The server side of all this is already written, tested and live-verified — see
`supabase/functions/README.md` for what that does and does not prove. What has never
executed is the Edge Function itself and the native checkout, which is exactly what this
build exists to make testable.
