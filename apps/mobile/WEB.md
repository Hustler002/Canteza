# Canteza on the web

The student, counter and delivery app runs in a browser from the **same code** as the
Android app, through `react-native-web`. Students open a link — no Play Store, no APK —
and can "Add to Home Screen" to get an app icon. The admin dashboard is a separate
Next.js app. Both deploy to **Vercel's free plan**.

## What is different on the web

| Area                 | Phone                          | Web                                                           |
| -------------------- | ------------------------------ | ------------------------------------------------------------- |
| Sign-in session      | Device keychain (`storage.ts`) | Browser storage (`storage.web.ts`)                            |
| Confirmation dialogs | System alert (`dialog.ts`)     | Browser `confirm`/`alert` (`dialog.web.ts`)                   |
| Online payment       | Razorpay native SDK            | Razorpay Standard Checkout, `checkout.js` (`razorpay.web.ts`) |
| Push notifications   | Yes                            | **Not yet.** The 🔔 inbox and live order updates still work   |
| Crash reporting      | Sentry (once the DSN is set)   | Off                                                           |

A `.web.ts` file sits beside its phone version and exports the same functions; Metro
picks it when bundling for the browser, so no screen checks which platform it is on.

**Payment methods on the web are Razorpay's, not ours.** Checkout offers "Pay online"
and "Cash on delivery"; what "Pay online" then shows — cards, wallets, netbanking, UPI —
is whatever the Razorpay account has switched on. **UPI is off on this account today**
(`GET https://api.razorpay.com/v1/methods?key_id=…` reports `upi: false`), so it will not
appear until Razorpay enables it. Nothing in the app needs to change when they do.

## Deploy: two Vercel projects from one repo

Sign up at https://vercel.com with GitHub (free), then **Add New → Project → import
`Hustler002/Canteza`** twice:

### 1. The student app

- **Root Directory:** `apps/mobile`
- **Framework Preset:** Other (`vercel.json` supplies the build command and output folder)
- **Environment Variables:**
  - `EXPO_PUBLIC_SUPABASE_URL` = `https://xsekofflcpocxewqzfbx.supabase.co`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY` = the `sb_publishable_…` key (the same one in `eas.json`)

Do **not** add the service role key, the Razorpay secret or any other secret here. Every
`EXPO_PUBLIC_` value is baked into the JavaScript anyone can download.

### 2. The admin dashboard

- **Root Directory:** `apps/admin`
- **Framework Preset:** Next.js (detected)
- **Environment Variables:**
  - `NEXT_PUBLIC_SUPABASE_URL` = the same URL
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the same publishable key

### 3. Tell Supabase where the app lives

Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL:** the student app's Vercel address, e.g. `https://canteza.vercel.app`
- **Redirect URLs:** add the same address and the admin's.

Sign-up confirmation emails link to the Site URL. Left at its default (`localhost`),
a new student's confirmation link points at nothing.

### 4. Razorpay

Test mode works on any address. Before **live** keys, Razorpay asks for the website
during activation — give it the student app's Vercel address.

## Updating it

Every push to `main` redeploys both projects. A pull request gets its own preview URL.

## Local commands

```bash
npm run web --workspace @canteza/mobile          # dev server in the browser
npm run build:web --workspace @canteza/mobile    # production build into apps/mobile/dist
npm run web:icons --workspace @canteza/mobile    # regenerate install icons from assets/icon.png
```

`public/index.html` replaces Expo's page template. Expo fills its language and title
placeholders with `String.replace` — **once each** — so neither may be written a second
time anywhere in that file, not even in a comment: the first match wins and the real one
ships unfilled. That happened once while writing it.
