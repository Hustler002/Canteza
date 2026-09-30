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
| Crash reporting      | Sentry (once the DSN is set)   | Sentry, when `EXPO_PUBLIC_SENTRY_DSN` is set in Vercel        |

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

**Sentry (optional, Production only):**

- `EXPO_PUBLIC_SENTRY_DSN` = the DSN from `eas.json`. Turns error reporting on. A DSN
  only lets a browser _send_ events, so it is safe in the bundle. Leave it off Preview so
  preview deployments do not report as production.
- `SENTRY_AUTH_TOKEN` = an organization auth token from Sentry (Settings → Auth Tokens),
  marked **Sensitive**. This one **is** a secret: it is read only by the build, which uses
  it to upload source maps so stack traces are readable. It never reaches the bundle.

`npm run build:web` exports with `--source-maps`, uploads them when the token is set,
and **always deletes them from the site** (`scripts/sentry-web-sourcemaps.mjs`). A
missing token or a failed upload is a warning in the build log, not a failed deploy.
It exports with `--clear` so a changed `EXPO_PUBLIC_*` value can never be hidden by a
cached transform.

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

### 5. CAPTCHA on sign-in and sign-up (Cloudflare Turnstile)

Sign-up is open to any email, so a script could create accounts and hammer sign-in. The
apps carry a Turnstile widget; GoTrue checks its token once CAPTCHA protection is on.
**The order matters** — switch Supabase first and every sign-in fails, because no build
yet sends a token.

1. **Cloudflare → Turnstile → Add widget.** Mode **Managed**. Hostnames:
   `canteza-mobile.vercel.app`, `canteza-admin.vercel.app`, and `localhost` for local work.
   The phone's WebView borrows `canteza-mobile.vercel.app` (`TURNSTILE_WEBVIEW_ORIGIN` in
   `src/lib/captcha.ts`), so that hostname stays on the list even without a web launch.
   Copy the **site key** (public) and the **secret key** (secret).
2. **Vercel, both projects, Production:** `EXPO_PUBLIC_TURNSTILE_SITE_KEY` on
   `canteza-mobile`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on `canteza-admin` — the site key,
   not the secret. Redeploy both, open each sign-in page and see the widget answer
   "Success!", and sign in once. Tokens are sent and ignored at this stage.
3. **Supabase → Authentication → Attack Protection → Enable CAPTCHA protection**,
   provider **Turnstile**, paste the **secret key**, save. From now on a sign-in without
   a valid token answers `CAPTCHA_FAILED`.
4. `npm run verify:live` — its sign-ins now go through `signInPastCaptcha` (a one-time
   link minted with the service key, redeemed by the anon client), so it still passes.

The phone needs the same site key in `eas.json`'s `env` (done for all three profiles)
**and a new build**: the widget runs in `react-native-webview`, which older development
builds do not contain. Such a build shows a notice and submits without a token, so it
keeps working until step 3 — and gets `CAPTCHA_FAILED` after it. The same fallback
covers a browser that blocks challenges.cloudflare.com.

**Done on 2026-09-30:** the widget exists (site key `0x4AAAAAAFKJBycg8MVUWL8b`, public);
the key is a Production variable on both Vercel projects, in all three `eas.json` profiles
and in both local env files. **Steps 3–4 done the same day:** CAPTCHA protection is on
in Supabase; a token-less sign-in answers `captcha_failed`; `verify:live` 97/97.

### 6. Student sign-up by college email, with a code

One mailbox, one account: a student account needs an `@mnnit.ac.in` address (no `+tag`)
and the 6-digit code emailed to it. The app, the migration (`campus_email_signup`) and
the email template are in the repo; the switches below are dashboard-only. **The order
matters**: turn on "Confirm email" before email can actually be delivered and no student
can finish signing up.

1. **Deploy the app** (push to `main`). The new sign-up asks for the college email and
   refuses anything else before sending, and shows a code step whenever GoTrue answers
   without a session. With "Confirm email" still off it answers with one, so nothing
   changes for students yet.
2. **Apply the migration:** `npm run db:push`. It adds the rule, the hook function and a
   trigger that stops a college account moving to another address. Nothing is enforced
   until step 5.
3. **Custom SMTP: Authentication → Emails → SMTP Settings.** Supabase's built-in sender
   delivers only to the project's team members, a few emails an hour, so without this no
   student ever gets a code. Any SMTP provider works; the cheapest start is a Gmail
   account with an **app password** (`smtp.gmail.com`, port 587, about 500 emails a day).
   A provider like Resend or Brevo needs a domain you own for good delivery. Then raise
   **Authentication → Rate Limits → emails per hour** from its SMTP default.
4. **Authentication → Emails → Confirm signup:** subject and body from
   `supabase/templates/confirmation.html`. A **code**, not a link: the default template
   sends a link, which confirms the address in the browser and never reaches the app.
5. **Authentication → Hooks → Before User Created:** Postgres, function
   `public.hook_before_user_created`. From now on sign-up refuses any other address, with
   `EMAIL_NOT_ALLOWED`, even from a script.
6. **Authentication → Sign In / Providers → Email → Confirm email: on.** From now on a
   new account has no session until its code is entered.
7. **Check it:** sign up from the web with a real college address; the code arrives, and
   entering it lands in Home. Sign-up with a Gmail address is refused.

**Staff accounts are made by the admin, not signed up:** the hook runs on public sign-up
and on invites (read in GoTrue's `signup.go` and `invite.go`), but **not** on
Authentication → Users → **Add user → Create new user**, or on the admin API
(`admin.go`), which is what `seed-users.mjs` uses. Create a canteen worker or delivery
partner there, with "Auto Confirm User" ticked, then attach them in the admin dashboard.
**"Send invitation" will not work** for a non-college address: the hook refuses it.

**Existing accounts keep working.** Sign-in is not restricted, so the `@campus.edu` demo
accounts and anyone who signed up before this can still sign in.

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
