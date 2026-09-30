# Canteza — project state

**Read this first in a new session.** Product and architectural background is in
[`context.md`](./context.md); the reasoning behind each choice is in
[`docs/decisions/`](./docs/decisions/).

---

## Where the project is right now

**Phase 8 in progress.** 557 tests green offline, plus 97 live checks
(`npm run verify:live`) covering auth, realtime, the full order path, RLS, menu
management, order history, engagement, canteen stats, the notification inbox, the
payment infrastructure and the online checkout. **The inbox is done. Razorpay works end
to end in test mode on a real Android phone** — card and wallet payments through the
native sheet, confirmed by the deployed webhook, and a declined card recorded with
Razorpay's reason. **UPI is not offered, and that is the Razorpay account, not the app**:
`GET /v1/methods` for the deployed key reports `upi: false`. Push works end to end on the
phone (foreground, background, cold-start taps, account switching, refusal). The student
web app (https://canteza-mobile.vercel.app) and the admin dashboard
(https://canteza-admin.vercel.app) are deployed from `main`; Sentry is still to do.

> **Commits are yours.** Never run `git commit` here — finish the work, run
> `npm run verify`, and hand it over.

> **Security, 2026-09-29.** The repo is **public**, and until that day it held the demo
> password in `seed-users.mjs` and `verify-live.mjs` while the same ten accounts —
> **an admin among them** — lived on the hosted project. With the publishable key also in
> the repo, anyone could have signed in as admin through the API. **Audit:** no evidence of
> unauthorized access. The last 24 h of platform logs (all that exists on this plan) show
> only this machine (`node`), the test phone (`okhttp`) and Supabase's own runtime, all
> from one Indian mobile range or Supabase itself; the table audit log is empty on this
> project; and the data shows no change an attacker would make — one admin, ten seeded
> users, no roles moved, nothing disabled, coupons and menus as seeded. Reads before the
> log window cannot be ruled out. **Done:** the six accounts `verify:live` uses got a
> random password, stored only as `SEED_PASSWORD` in the root `.env` (now required — no
> default anywhere); `meera`, `night.canteen`, `imran` and `hostel.canteen` are **banned**
> (reversible, with a random password nobody holds — re-enable with
> `auth.admin.updateUserById(id, { ban_duration: 'none', password })`); every session was
> revoked. No other secret has ever been committed — checked across all of git history.
> **Rule: no credential is ever a literal in this repo, not even a demo one.**

> **Pre-launch security pass, 2026-09-29.** The live project was attacked with real
> sign-ins for every role and with no session at all (anon key only) — a scratch script,
> one attack per line, never printing a token. **83 attacks were refused**: no anonymous
> read of any table or RPC, no cross-student read of orders, items, payments, history,
> notifications, tickets or push tokens, no self-promotion, no payment or order write by
> any client (admins included), no cross-canteen read or write, no partner self-approval,
> no admin self-demotion. The Edge Functions were read and hold up (owner check in
> `create-payment`, HMAC before parsing in `verify-payment`, constant-time secret in
> `send-push`). **Four real holes, fixed in `..._security_hardening.sql`:**
>
> 1. **Suspension did not stop canteen staff.** `my_canteen_id()` ignored
>    `profiles.is_active`, so a suspended counter worker still read the canteen's orders
>    (names, phones, rooms) and edited its menu — proven live on `juice.corner`, restored
>    at once. Now it joins profiles like `my_delivery_canteen_id()` always did; a trigger
>    on `orders` refuses **any** write by a suspended user (`ACCOUNT_SUSPENDED`), whatever
>    function makes it; and `admin_set_profile_active` also **bans the account at Auth**
>    (`banned_until` +100 years, which is what GoTrue's own `876000h` writes — not
>    `'infinity'`, which Go cannot read) and deletes its sessions. Sign-in then answers
>    "User is banned", mapped to `ACCOUNT_SUSPENDED`.
> 2. **A student could forge a complaint** — insert a ticket already `resolved`, with a
>    `resolution` in the admin's voice, pinned to someone else's order. INSERT is now a
>    column grant (`student_id, order_id, subject, body`), the policy requires the order
>    to be the student's own, and the admin's UPDATE is narrowed to `status, resolution`.
>    Reviews got the same column grant.
> 3. **No free text had a length limit** (a 200 KB name was stored) and **picture links
>    took any scheme** (`javascript:` was stored). CHECK constraints now, mirrored in
>    `TEXT_LIMITS` / `isHttpsUrl` (`packages/shared/src/limits.ts`) for every form;
>    `supabase/test/limits.test.ts` fails if the two disagree.
> 4. **No ceiling on open orders.** Sign-up is open and cash needs no card, so one account
>    could fill a counter's board. At most 5 open orders **placed in the last 12 hours**
>    (`max_open_orders_per_student`) — the window because nothing sweeps a cash order a
>    canteen never answered, and without it five of those would lock a student out for
>    good. riya has 18 such stale test orders on the live project; the window is why that
>    does not break `verify:live`.
>
> Plus the advisor's findings (search_path on four functions, helpers off `anon`, the
> signup trigger off the RPC surface, `canteens_public` → `security_invoker`), the
> admin's missing headers (clickjacking: `frame-ancestors 'none'`, `X-Frame-Options`,
> `nosniff`, no `X-Powered-By`), and a **CSP on the web app** (`vercel.json`), proven in a
> browser against the production build: no violations on sign-in, Home with live data,
> the realtime websocket, or Razorpay Checkout opening its frame. Razorpay also loads a
> fraud-check script from `cdn.razorpay.com`, which the first draft blocked. **A new
> third-party script, font or API host must be added to that CSP or it will not load.**
>
> **Live since 2026-09-30** (`db push`, approved by the owner; 20 migrations applied).
> Before pushing: every live row was checked against the new constraints (0 of 1,074
> violated them), a JSON export of all 21 tables and a snapshot of every function, policy,
> grant, constraint, trigger and view were taken (the Free plan has no restorable
> backups), and a rollback script built from that snapshot was proven in PGlite to return
> the schema exactly to its prior state. Kept outside the repo, because the export holds
> personal data. A per-table md5 fingerprint before and after the push was identical
> in all 20 tables: the migration touched no row. **After:** `verify:live` 97/97; the
> attack script **94 refused, 0 real holes** (its one "VULN" line is the counter seeing the
> students on its live orders, which is the design — checked: 4 profiles visible, all 4
> entitled). **Suspension proven live through the admin path** on `juice.corner`: sign-in
> answered "User is banned", its refresh token was gone, and the still-unexpired access
> token resolved no canteen, read 0 orders, edited nothing, and `transition_order`
> refused it; restored at once, it signed in and saw its canteen's orders again.
> **Sign-up still works with `handle_new_user` off the RPC surface**: a person signed up
> from the web at 11:31:43 UTC and got an active `student` profile with its name in the
> same millisecond, confirmed and signed in 0.8 s later. The
> advisor now reports only `canteen_stats` (by design), the RPCs signed-in users are meant
> to call, and leaked-password protection.
>
> **Deliberately left as is:** `reviews_read` is `true` (a review carries a pseudonymous
> `student_id`; profiles are not readable); every active coupon code is listable by any
> signed-in user (the checkout offers them — a code meant to stay private needs a
> different design); `canteen_stats` stays a definer view (see its section).

```
✅ Phase 0  assessment, architecture, ADRs
✅ Phase 1  monorepo, tooling, shared domain core + 33 tests
✅ Phase 2  schema, RLS, RPC functions, seed data + 107 tests (ADR 008 rework + audit)
✅ Phase 3  typed data access, auth, role routing, both app shells + 22 tests
✅ Phase 4  browse -> cart -> checkout -> order -> canteen board -> live status + 14 tests
✅ Phase 5  delivery queue, claim, pickup, deliver, shift toggle, record + 17 tests
✅ Phase 6  admin: orders, canteens, staff, accounts, hostels, revenue + 99
✅ Phase 7  menu, history, ratings, reorder, favourites, coupons, support
🔶 Phase 8  inbox, Razorpay (test mode), sweep, push — all proven on device; Sentry, deploy  ← IN PROGRESS
```

Full plan: [`docs/roadmap.md`](./docs/roadmap.md).

## What exists

```
package.json            npm workspaces root; scripts below
tsconfig.base.json      strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
eslint.config.js        flat config, typescript-eslint recommended
vitest.config.ts        packages/**/test, apps/**/test, supabase/test
supabase/tsconfig.json  so `npm run typecheck` actually covers the database tests
.env.example            all three env files in one place — see "Environment" below
.gitattributes          LF everywhere, so a Windows clone does not fail format:check
docs/architecture.md    the living architecture document
docs/decisions/         ADRs 001–008
packages/shared/        the domain core
supabase/               migrations, seed, RPC functions, database tests
```

```
apps/mobile/            Expo + expo-router. Student / Canteen / Delivery
apps/admin/             Next.js 16 App Router (src/proxy.ts, not middleware.ts)
packages/api/           Typed data access: client, auth, error mapping, query keys
scripts/gen-types.mjs   Generates database.types.ts from the migrations, no Docker
scripts/verify-live.mjs Live checks against a real project, anon key only
```

### `packages/shared` — the domain core

Consumed as TypeScript source (no build step). Everything else depends on it.

| Module              | Holds                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| `brand.ts`          | Name, tagline, support email, locale. The **only** place the name lives.  |
| `money.ts`          | Integer paise. `formatPaise`, `rupeesToPaise`. Throws on non-integers.    |
| `roles.ts`          | `student` \| `canteen` \| `delivery` \| `admin`                           |
| `order-status.ts`   | **The order state machine.** Transition table, actor permissions, labels. |
| `payment.ts`        | Payment statuses, methods, transition table                               |
| `pricing.ts`        | `computeTotals`, coupon maths. The only place order money is computed.    |
| `rules.ts`          | `validateOrderPlacement` — cart rules, mirrored in SQL                    |
| `errors.ts`         | `AppError`, stable error codes, safe user-facing messages                 |
| `notifications.ts`  | Wording per audience × status, `notificationContext`, `PUSH_CHANNEL`      |
| `config.ts`         | Platform defaults (delivery fee, max quantity, platform fee)              |
| `database.types.ts` | **Generated.** `npm run db:types`. Never edit by hand.                    |

### `packages/api` — typed data access

| Module             | Holds                                                                        |
| ------------------ | ---------------------------------------------------------------------------- |
| `client.ts`        | `createCampusClient({ url, anonKey, storage })`. Refuses a service role key. |
| `auth.ts`          | `signIn/signUp/signOut`, `getIdentity()` -> role + canteen from the DB       |
| `errors.ts`        | `mapSupabaseError`, `unwrap` — every failure becomes an `AppError`           |
| `keys.ts`          | The single TanStack Query key registry                                       |
| `catalog.ts`       | Canteens, menus, hostels, the student's default address                      |
| `orders.ts`        | `placeOrder`, `transitionOrder`, order reads with embedded items             |
| `realtime.ts`      | `subscribeToOrders` + `orderFilters`. Hands back no payload, by design       |
| `notifications.ts` | Inbox reads, mark read, `registerPushToken` / `unregisterPushToken`          |
| `delivery.ts`      | Queue, claim/release, shift toggle, `summariseDeliveries` (counts, not pay)  |
| `payments.ts`      | `startCheckout` -> `create-payment`. Asks for a payment; never asserts one   |

### `supabase/` — the database

| File                                   | Holds                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `..._schema.sql`                       | 19 tables, indexes, `canteens_public` view, `order_transitions` table         |
| composite FK                           | `orders (delivery_partner_id, canteen_id)` -> `delivery_partners`             |
| `..._rls.sql`                          | RLS helpers, policies, column-level grants, realtime                          |
| `..._functions.sql`                    | `place_order`, `transition_order`, `claim_delivery`, `release_delivery`       |
| `..._student_default_address.sql`      | `profiles.default_hostel_id/block/room`, all-or-nothing                       |
| `..._delivery_shift_toggle.sql`        | `is_online` gates the queue and claiming; `OFF_SHIFT` error                   |
| `..._harden_default_privileges.sql`    | **Security.** Revokes Supabase's blanket grants, restates the real ones       |
| `..._admin_set_partner_active.sql`     | Admin ends or restores a delivery posting; canteen id is explicit             |
| `..._canteen_column_grants.sql`        | **Security.** Staff write hours + pause only; admin writes via RPC            |
| `..._canteen_create.sql`               | `admin_create_canteen`; canteens lose client INSERT and DELETE                |
| `..._canteen_staff_attach.sql`         | Attach/detach staff; writes the role with the row. RPC-only table             |
| `..._delivery_partner_guards.sql`      | Onboarding works on a disabled canteen; refuses counter staff                 |
| `..._profiles_and_hostels_admin.sql`   | `admin_set_profile_active`; no self-demotion; hostels lose DELETE             |
| `..._revenue_view.sql`                 | `revenue_by_canteen_day`, **security_invoker** so RLS scopes it               |
| `..._service_role_grants.sql`          | **Security.** States what service_role may do; nothing granted it before      |
| `..._canteen_stats.sql`                | Ratings + median kitchen minutes. NOT security_invoker, on purpose            |
| `..._razorpay_payments.sql`            | `record_payment_result`, `begin_razorpay_payment`, `expire_unpaid_orders`     |
| `..._razorpay_checkout.sql`            | In-sheet retries, first-writer-wins, `REFUND_REQUIRED`, quiet counter         |
| `..._push_tokens.sql`                  | One row per device; `register_push_token` moves it to whoever signs in        |
| `..._prepaid_student_notification.sql` | Student's "Order placed" waits for the payment too, like the counter's        |
| `..._campus_email_signup.sql`          | **Security.** Sign-up hook: college mailbox only; a college account stays one |
| `seed.sql`                             | 4 canteens, 28 menu items, 4 hostels, 3 coupons, platform settings            |
| `seed-users.mjs`                       | Accounts via the Auth API, then demo orders through the real RPCs             |
| `functions/`                           | `create-payment`, `verify-payment`, `send-push` (Deno) + tested `_shared/`    |
| `test/`                                | 267 tests on in-process Postgres and `_shared/` — see `test/README.md`        |

**The RPC surface** (everything else is a plain PostgREST select):

```
place_order(canteen, items, hostel, block, room, idempotency_key, note, coupon, method) -> uuid
transition_order(order_id, to_status, reason?) -> text
claim_delivery(order_id)   -> uuid     -- atomic; raises DELIVERY_ALREADY_CLAIMED
release_delivery(order_id) -> text     -- back to the pool
admin_set_role(profile_id, role)
admin_set_partner_canteen(profile_id, canteen_id, approved)   -- onboard or transfer
admin_set_partner_active(profile_id, canteen_id, active)      -- admin retires or restores
admin_update_canteen(canteen_id, name, description, phone, image_url,
                     min_order_paise, opens_at, closes_at, accepting)
admin_set_canteen_active(canteen_id, active)                  -- disable, never delete
admin_create_canteen(name, description, phone, image_url,
                     min_order_paise, opens_at, closes_at) -> uuid  -- starts disabled
admin_attach_canteen_staff(profile_id, canteen_id)   -- moves them if already posted
admin_detach_canteen_staff(profile_id, canteen_id)   -- and puts the role back
admin_set_profile_active(profile_id, active)         -- suspend; never yourself
canteen_set_partner_active(profile_id, active)                -- canteen retires own staff
```

## Commands

```bash
npm run verify         # format + lint + typecheck + test — run before finishing work
npm test               # vitest (includes the database tests; no Docker needed)
npm run db:start       # supabase start          (needs Docker)
npm run db:reset       # re-apply migrations + seed.sql
npm run db:seed:users  # demo accounts + demo orders (needs a running Supabase)
npm run db:types       # regenerate database.types.ts from the migrations (no Docker)
npm run functions:sync # copy the notification wording into the Edge Functions; a test checks it
npm run verify:live    # 97 checks on the live project: auth, realtime, order path, RLS, pay
npm run dev:mobile     # expo start
npm run dev:admin      # next dev
npm run db:push        # deploy migrations to the linked project
```

## Phase 8 — where it actually stands

**Started. The in-app notification inbox is done and proven live (§9).** The rest is
blocked on things only an account holder can supply, and it is worth knowing which,
because the order is forced rather than chosen:

| Track        | State          | Blocked on                                                                                                                                                                                                                                                   |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| In-app inbox | ✅ done        | —                                                                                                                                                                                                                                                            |
| Expo push    | 🔶 server live | Server side deployed and proven live (webhook → `send-push`, 200s). Push build submitted 2026-09-27; device test pending                                                                                                                                     |
| Razorpay     | 🔶 test mode   | **Works end to end on a real phone in test mode.** UPI is disabled on the Razorpay account (`upi: false`); live keys not yet used                                                                                                                            |
| Sentry       | 🔶 web proven  | **Web live:** the deployed bundle (`7421155`) sent an error to Sentry, answered 200. Source maps uploaded by that build (its log: `[sentry] 2 source maps uploaded.`). Phone: Sentry build exists, never sent an event                                       |
| EAS / Vercel | 🔶 EAS done    | Android dev build runs on a real phone. **Student web app live** at https://canteza-mobile.vercel.app (Vercel project `canteza-mobile`); **admin live** at https://canteza-admin.vercel.app (`canteza-admin`). Both build from `main` (`apps/mobile/WEB.md`) |
| CI           | ✅ done        | `.github/workflows/verify.yml` has run the suite since Phase 6                                                                                                                                                                                               |

**That fork has been taken:** push, Sentry and the Razorpay sheet all needed a
development build rather than Expo Go, and one now exists (`apps/mobile/EAS.md`). It is
served by `npm run dev:mobile` like Expo Go was — and, as rule 18a records, it serves a
**cached bundle until reloaded**, so prove a change is running before judging it.

### Razorpay: what is proven and what is not

**Proven.** `record_payment_result` is the only path to a successful payment, and it is
idempotent on `provider_payment_id`, refuses a correctly-addressed webhook carrying the
wrong amount, and refuses a move the payment state machine does not define. Signature
verification is tested against digests computed independently with Node's `createHmac`
rather than with the module under test — a verifier checked against itself proves only
that it agrees with itself. `expire_unpaid_orders()` closes ADR 006's open gap. All of
it ran against the live project end to end: place a prepaid order, watch the canteen be
refused, record the webhook, watch the canteen be allowed.

**Proven on a device, in test mode (2026-09-27).** Both functions deployed; the native
sheet opened on the Android dev build (so autolinking did register the module); two card
and wallet payments reached `success` through the real webhook; a declined international
card reached `failed` carrying Razorpay's own reason; `verify:live` §11 passes against
the deployed `create-payment`.

**Not proven, and must not be described as such.** Live keys and real money; UPI (off on
the account — see below); iOS; and the in-sheet retry and `REFUND_REQUIRED` paths, which
are proven in SQL but have not been produced by real Razorpay traffic.

**UPI is an account setting, not code.** Razorpay's public `/v1/methods?key_id=...`
endpoint lists what a key may offer, and the sheet hides any method it reports `false`.
For this account `upi` is `false` (`upi_intent` is `true`, which does not help while
`upi` is off). Nothing in the app passes a method list, so the fix is in the Razorpay
dashboard or with Razorpay support, and that endpoint is the check that it has taken
effect. Once it is on, UPI **intent** — handing off to GPay or PhonePe — may additionally
need a `<queries>` entry in the Android manifest for package visibility on Android 11+,
which would be a config plugin and a rebuild. Unverified; try it before writing one.

### The native checkout

`src/lib/razorpay.ts` is the only file that knows `react-native-razorpay` exists, and
it **never imports it statically**: the package builds a `NativeEventEmitter` at module
load, which throws on iOS when the module is absent — Expo Go, or a build without it.
Availability is asked of `TurboModuleRegistry` first and the package loaded with
`import()` only then. `apps/mobile/test/razorpay-import.test.ts` pins that on the
source, proven to fail on a planted static import.

The flow, and the one idea behind it — **the sheet's answer is a hint, the server's is
the fact**: checkout places the order (unpaid), `create-payment` returns a Razorpay order
for the amount on our own `payments` row, the sheet opens on it, and whatever happens the
student lands on the order screen. That screen shows "confirming" (the sheet said done),
"payment failed" (the webhook said declined) or "not completed", with a Pay button for
the last two, and polls every 3s while confirming in case realtime is quiet — realtime is
the mechanism, because `record_payment_result` touches the order. Nothing in the app
writes a payment, because nothing could: `payments` has no client write grant.

The **key id is not in the app** or in `eas.json`. `create-payment` returns it with the
Razorpay order, so the sheet always opens with the key whose secret made the order.

**With a coupon typed, the button reads "Continue to payment", not "Pay ₹X".** The
client never computes a discount (Phase 7), so a figure would overstate the charge; the
sheet shows the real amount, which came from `place_order`.

**`supabase/tsconfig.json` must include `functions/_shared/**`.** It listed only
`test/**`, so `tsc -b` refused the import with TS6307 and **`npm run verify` failed on
the committed tree** from the Razorpay backend onwards — the earlier "typecheck green"
for that work was wrong. Found here by type-checking a clean worktree of `HEAD`.

**Two signatures, not one, and they are not interchangeable.** The webhook is
`HMAC_SHA256(raw_body, WEBHOOK_SECRET)`; the checkout callback is
`HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)`. ADR 006 documented only the
second. The raw body matters: `await req.json()` re-orders keys and the signature stops
matching, which Razorpay's own docs warn about. See `supabase/functions/README.md`.

**The inbox needed no migration.** Everything was already there and unused:
`notify_order` writing a row per transition, `notifications_own` scoping reads,
`grant update (read_at)` allowing exactly one column to be written, and
`notifications` already a member of the `supabase_realtime` publication. Phase 8's
first piece was a reader, not a schema change.

**The row stores no text** — `(audience, status, order_id)` — and the wording comes
from `orderNotification()` in `packages/shared`, which is the same function push will
call. That is why rewording a message needs no migration and no backfill, and why the
two surfaces cannot drift.

`(student)/inbox.tsx`, not `notifications.tsx`: rule 19 again. A future
`(canteen)/notifications.tsx` would resolve to the same `/notifications` and one would
silently shadow the other.

### Push notifications

**Server side deployed and proven live; the phone side has never run.** Verified on
2026-09-27 before the build was started: `push_tokens` migrated with RLS on and
`register_push_token` callable by the app; `send-push` active with gateway JWT off;
`PUSH_WEBHOOK_SECRET` set; the Database Webhook is a per-row **INSERT-only** trigger on
`notifications` that POSTs to `send-push` with the `x-push-secret` header (checked as
booleans, so the secret is never printed); `GOOGLE_SERVICES_JSON` is a secret file
variable in the EAS development environment. `verify:live` §12 passes, and **22 real
webhook calls answered 200 `{"sent":0}`** — read back from `net._http_response`, which
is how to check this again: no 401s means the secret matches, and `sent: 0` only because
no phone had registered yet. The FCM V1 key in EAS credentials could not be checked from
here (`eas credentials` is interactive); a missing key shows up as an Expo ticket error.

**The push build exists** (EAS build `597b6b91`, finished 2026-09-27). Its log is the proof
Firebase went in: on the builder `GOOGLE_SERVICES_JSON` pointed at the secret file and
Gradle ran `:app:processDebugGoogleServices`, a task that only exists when a
`google-services.json` is applied. `react-native-razorpay` still compiles into it. EAS
logs are brotli-compressed JSON lines; `zlib.brotliDecompressSync` reads them.

**Correction:** this file used to say push needed no rebuild because
`expo-notifications` was already compiled in. Wrong: an Android Expo push token is an FCM
token underneath, and the app cannot get one unless `google-services.json` is compiled
into it. Checked in the package, not assumed.

The shape, and why each piece is where it is:

- **Push is a second delivery of an inbox row.** `notify_order` still decides who hears
  what; a Database Webhook on INSERT into `notifications` fires `send-push`, which looks
  up the recipient's devices and sends. So the counter not being paged for an unpaid
  order (the checkout migration) holds for push with no extra code.
- **The wording is a generated copy, checked by a test.** Deno cannot import
  `packages/shared` (no extensions on imports, and deploy bundles only
  `supabase/functions`), so `npm run functions:sync` writes
  `_shared/notifications.generated.ts`. `supabase/test/push.test.ts` fails when it is
  stale, and compares every audience × status through both copies — proven to fail on an
  unsynced rewording. **Reword → `functions:sync` → redeploy `send-push`.**
- **A device is keyed by its token, not by (user, token).** A phone has one person
  signed in at a time; `register_push_token` moves the row to whoever signs in, so a
  handed-on phone stops showing the previous owner's orders. That write touches a row the
  caller does not own, which is why it is an RPC and there is no INSERT grant.
- **Sign-out unregisters first**, while the session still exists to delete its own row.
- **Every sign-out asks first, through one `useConfirmSignOut()`** in `session.tsx`.
  Found on the device: students had no sign-out at all (`RoleHome`, the Phase 3 shell
  with the button, is rendered by nothing), and once they did, theirs asked while the
  counter's and the partner's signed out on one stray tap — each screen had wired its
  own. The prompt says what it costs for the role signed in (`sign-out.ts`), including
  that signing out does **not** end a delivery shift, since `is_online` lives in the
  database. `test/sign-out.test.ts` fails if any file but `session.tsx` mentions
  `signOut`. Sign-out also **empties the cart**, persisted to AsyncStorage, which the
  next student on a shared phone would otherwise inherit.
- **A signed-in group renders nothing once nobody is signed in** (`SignedInStack`, used by
  all three role layouts). Sign-out clears the identity and every screen reading the
  session re-renders _before_ the root guard's effect can navigate away, so a mounted
  screen called `useIdentity()` with no one signed in and the app crashed — the counter
  hit it on the device, 2026-09-28, after tapping "New order" and reloading. Proven fixed
  by rerunning that exact sequence. **Seen once and not reproduced:** a student signing
  in after the counter landed on an old order instead of Home. Two reruns with
  diagnostics on landed on Home; if it recurs, instrument `RouteGuard` and
  `PushBridge` before theorising.
- **Permission is `status`, never `granted`** (`pushAllowed`). On Android,
  expo-notifications sets `granted` from the POST_NOTIFICATIONS permission alone, while
  `status` also checks `areNotificationsEnabled()` — so with notifications switched off in
  Settings `granted` can still read true. **That is from the library source, not from the
  device:** the run first taken as evidence turned out to have notifications switched on.
  A refused device is now also **removed** from `push_tokens` on each start, so switching
  notifications off stops the sends rather than leaving Android to discard them — _that_
  is proven on the device (app-wide switch off, reload, registration gone).
- **Everything on the phone fails quietly.** Refused permission, Expo Go, a build without
  Firebase: registration logs `[push] registration skipped` and the app is unchanged.
- **A tap opens a screen only for the role signed in now** (`routeForPush`), and **at
  most once per device, ever** (`claimResponse`, which remembers the last tap handled in
  AsyncStorage). Clearing Expo's last response is not enough, and the device test proved
  it: on Android the tap that cold-started the app sits in
  `NotificationManager.pendingNotificationResponsesFromExtras`, which is never emptied
  and is replayed to the notifications module whenever it registers — every new JS
  runtime, so every reload — with the same identifier each time. Without the on-disk
  guard the student was dropped back onto that order.
- **No Firebase file is committed.** `google-services.json` (project `canteza-7006c`,
  package `edu.campus.canteza`) and any `*firebase-adminsdk*.json` are gitignored. The
  build gets the first from the EAS **secret file variable** `GOOGLE_SERVICES_JSON`
  (development environment — `eas.json`'s development profile names it), via
  `apps/mobile/app.config.js`, which falls back to the local file and otherwise leaves
  the setting out so a clone without it still builds, just without push. The service
  account key lives only in EAS credentials (FCM V1). `expo config --type introspect`
  shows the plugin writing the FCM icon, colour and `orders` default channel into the
  manifest; `POST_NOTIFICATIONS` comes from the library's own manifest.
- **Not done:** Expo's delayed _receipts_ are not checked, only the immediate tickets
  (`DeviceNotRegistered` prunes the token). Add receipts if pushes go missing.

### Sentry

**Built in, and off until the DSN reaches `.env`.** The Sentry development build
(EAS `1843d5b0`, 2026-09-28) compiled `:sentry_react-native` alongside
`processDebugGoogleServices` and `react-native-razorpay`, and made no source-map upload
(debug variant, as `sentry.gradle` says). Not yet proven: an event reaching Sentry. `@sentry/react-native` ~7.11.0 (what
`expo install` picks for SDK 57) is installed; `src/lib/sentry.ts` starts it,
`Sentry.wrap` wraps the root layout, the query client offers every failed query and
mutation to `reportIfUnexpected`, and the session tags events. Setup steps are in
`apps/mobile/EAS.md` "Sentry: the third build".

- **Off until `EXPO_PUBLIC_SENTRY_DSN` is set**, written out in full so Expo inlines it.
  No DSN, no events — from any build.
- **Only `UNKNOWN` handled errors are reported** (`report.ts`, tested). Anything with a
  code already has a message on screen; reporting it would bury the real bugs under
  "canteen closed".
- **An id and a role, nothing else, about a person.** No names, phones or rooms;
  `sendDefaultPii: false`; cleared at sign-out with the rest of the account's state.
- **Metro uses `getSentryExpoConfig`**, which wraps `expo/metro-config` and stamps every
  bundle with a debug id; `expo-doctor` still passes 21/21. **The bundle grew 3.8 → 5.3
  MB** — the SDK's cost, not a mistake.
- **A release build needs `SENTRY_AUTH_TOKEN`** (EAS secret) or fails at the source-map
  upload; a development build does not, because `sentry.gradle` uploads only for
  non-debug variants. Read from the package source, not assumed.
- **Configured (2026-09-28):** org `moneytrail`, project `canteza-mobile`, in the plugin
  entry in `app.json`; the DSN in all three `eas.json` profiles. **Not yet in
  `apps/mobile/.env`, on purpose**: with a DSN the SDK looks for its native module, and
  an APK built without it answers every reload with a "could not connect" alert.
- **Changing an `EXPO_PUBLIC_*` value locally needs Metro restarted with `--clear`.**
  Proven, not assumed: an export with `EXPO_PUBLIC_SENTRY_DSN` set produced a bundle
  without it until the cache was cleared — Metro had kept the transform from when the
  value was absent. The same applies to `expo start`.
- **`@sentry/cli`'s install script is not approved** (npm 11 `allowScripts` lists only
  esbuild). It downloads the binary that uploads source maps, so it matters for the first
  release build, not the development one — approving it is a decision for then.
- **A test error is one shake away** in any development build: "Sentry: send a test
  error" and "Sentry: crash the app (native)" in the dev menu (`dev-menu.ts`). A release
  bundle contains neither — checked by grepping the exported bundle.

**On the web (2026-09-29).** The same `sentry.ts` runs in the browser: on web the SDK
installs the browser's global error handlers instead of the native ones (read in
`integrations/default.js`). **Proven locally:** a production export with the DSN, served
like Vercel, sent an uncaught error as two envelopes to `ingest.us.sentry.io`, both
answered **200**. **Live since `7421155`:** `EXPO_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` are Vercel
Production variables, the deployed bundle carries the DSN and a debug id, and its files —
relayed byte for byte through localhost, since the browser pane blocks remote scripts —
sent an uncaught error that Sentry answered **200**. A request for the bundle's `.map`
gets **403** from Vercel.

- **Source maps:** `build:web` exports with `--source-maps`, and
  `scripts/sentry-web-sourcemaps.mjs` uploads them through Sentry's own
  `expo-upload-sourcemaps` when `SENTRY_AUTH_TOKEN` is set, then **always deletes them
  from `dist`**. Sentry matches by the debug id `getSentryExpoConfig` stamps into each
  bundle, so the site never needs to serve a map. A missing token or failed upload is a
  warning, never a failed deploy. `test/sentry-web-sourcemaps.test.ts` runs it for real
  against a stand-in `sentry-cli` (`SENTRY_CLI_EXECUTABLE`), and fails if a map is left
  behind — proven on a probe.
- **Sentry's upload script looks for the plugin `@sentry/react-native/expo`**; app.json
  names `@sentry/react-native`, so org and project are passed as environment variables
  read from app.json. Without that the script would shell out to `expo config` and exit 1.
- **`sentry-cli` needs no install script:** it ships as per-platform optional packages
  (`@sentry/cli-linux-x64` is in the lockfile), so npm 11's unapproved postinstall does
  not matter for the web upload.
- **`--clear` on `build:web`**, because a cached Metro transform can hide a changed
  `EXPO_PUBLIC_*` value (above) — a DSN added in Vercel must not silently miss the bundle.
- **The upload ran with the real token** on the `7421155` Vercel build: its log reads
  `[sentry] 2 source maps uploaded.`, a line the script prints only when Sentry's upload
  script exited 0, which it does only if `sentry-cli` accepted every map (`execSync`
  throws otherwise). Read by a person — the token is never given to Claude and the Vercel
  connector cannot see this project. **Not yet seen:** a stack trace de-minified in the
  Sentry UI.

## The web app

**Decided 2026-09-29: launch on the web first.** A Play Store account costs $25 up front;
the same `apps/mobile` code runs in a browser through `react-native-web`, reaches iPhone
users an APK cannot, and deploys free on Vercel. The Android build stays; the Play Store
waits until the web version earns. Deploy steps, and what differs from the phone, are in
**`apps/mobile/WEB.md`**.

**How it differs, and how that is kept honest.** Each platform-specific piece is a
`.web.ts` file beside its phone version, exporting the same functions — Metro picks it
for the browser, so no screen branches on platform:

- `storage.web.ts` — browser storage for the session. `expo-secure-store`'s web module
  is an **empty object** (read in the package), so without it nobody could sign in.
- `dialog.ts` / `dialog.web.ts` — **the only place `Alert` is called.** react-native-web's
  `Alert.alert` is a no-op, and 14 actions — cancel, reject, give back, sign out — waited
  on a dialog's button, so on the web they silently did nothing. The browser's own
  `confirm` spells out both labels (`OK: Reject · Cancel: Keep it`).
  `test/dialog.test.ts` fails if any other file mentions `Alert`; proven on a probe.
- `razorpay.web.ts` — Razorpay **Standard Checkout** (`checkout.js`, loaded on first use
  only) against the same `create-payment` order and key. Same contract as the phone: the
  promise ends only on "finished" or "closed", a declined card keeps the sheet open, and
  only the webhook marks anything paid. `test/razorpay-web.test.ts` pins it.
  **UPI shows only when the Razorpay account enables it** — today `upi: false`.
- **No push on the web yet.** `PushBridge` is not mounted there: expo-notifications has
  no `getLastNotificationResponse` on the web, so `useLastNotificationResponse` throws
  `UnavailabilityError` the moment anyone signs in (read in the package source). Web push
  means a service worker and VAPID keys — its own piece of work.

**Also fixed on the way, for both platforms:** token auto-refresh only ever started on an
`AppState` _change_, so an app opened straight into the foreground — and a browser tab
simply left open — never started it. It now starts at load when the app is active.

**Installable ("Add to Home Screen").** `public/manifest.json`, `public/index.html` (a
copy of Expo's template plus the manifest and touch-icon links), and 192/512/180 px icons
generated from `assets/icon.png` by `npm run web:icons`. **Expo substitutes the template's
language and title placeholders once each, with `String.replace`**, so neither may be
written twice in that file — a comment that named them sat above the real ones and would
have shipped a page titled with the raw placeholder. `vercel.json` falls back to
`index.html` for every path (deep links like `/order/…` load the app, checked), caches
hashed bundles for a year and sets three security headers.

**Proven in a browser (production build served like Vercel):** loads with no console
errors; manifest valid and both icons 200; a deep link returns the app; a signed-in page
opened while signed out goes to sign-in; `checkout.js` loads and defines `Razorpay`.
**Proven on the deployed site by a person (2026-09-29), read back from the database:** riya
signed in on https://canteza-mobile.vercel.app, placed a cash order and cancelled it
(payment `failed` / "cancelled by student" — so the browser `confirm` dialog works), then
paid a second order online through Razorpay Standard Checkout, which the webhook
confirmed (`success`); admin signed in on https://canteza-admin.vercel.app. **Sign-up
proven too:** a new account created from the web at 06:17:48 UTC was confirmed
automatically, signed in 0.4 s later by the same tap (`signUp` then `signIn`), and got a
`student`, active profile with its name — the first account on the project not made by
`seed-users.mjs`.

## The mobile design system

`src/theme.ts` holds the tokens (colour, space, radius, type, **elevation**, motion,
**layout**); `src/components/ui.tsx` holds the primitives; `src/components/patterns.tsx`
holds the compositions — `AppBar`, `IconButton`, `Icon`, `Chip`, `SectionHeader`,
`CardTitle`, `OptionCard`, `CheckRow`, `Fact`, `Divider`, `Skeleton`, `SkeletonList`,
`Price`, `QtyStepper`, `Thumb`, `VegMark`, `Rating`; `motion.tsx` holds `FadeIn`,
`useReducedMotion` and `webInteractive`; `auth-shell.tsx` frames sign-in/up; `logo.tsx`
holds `LogoMark`, the `Logo` lockup and `BrandBar`.

**The 2026-09-29 visual refresh** (presentation only — no query, RPC, auth or payment code
changed). What it settled, so later screens match rather than drift:

- **Surface on background, not outlines.** White cards on a warm stone page
  (`background` `#F6F4F1`), lifted by a warm-tinted shadow (`elevation.card`); a card's
  own border is `cardBorder`, transparent in light mode and a hairline in dark, where a
  shadow cannot be seen. `Card` takes `onPress` (sinks on press, rises on hover) and
  `highlight` (a brand outline for the one card about something happening now).
- **Every page is a centred column on a wide screen** (`layout.content` 720,
  `layout.wide` 1080). `Screen` applies it to its own content; an unpadded screen that
  renders its own `FlatList` passes `columnStyle(t)` to the list's
  `contentContainerStyle` (and its header), so the list still scrolls from anywhere in
  the window. Home is the one `wide` screen: canteens go two abreast at ≥ 760px.
- **Icons are Ionicons via `@expo/vector-icons`** (`Icon`, and the `icon` prop on
  `IconButton`, `Button`, `Chip`, `Fact`, `CardTitle`). JavaScript plus a font file — the
  phone build already has `expo-font`, so adding it needed no rebuild. The text glyphs it
  replaced (`◔ ☰ ⏻`) read as unfinished.
- **The web has its own typeface; the phone does not.** Plus Jakarta Sans loads from
  Google Fonts in `public/index.html` (`display=swap`) and `theme.ts` sets `fontFamily`
  only when `Platform.OS === 'web'`. A custom font on the phone means bundling files and
  holding the splash screen — a rebuild for little gain over Roboto/SF.
- **Motion is optional.** `FadeIn` staggers the first screenful of a list (never row 40)
  and `Skeleton` breathes; both run on the native driver on the phone and both stop when
  the device asks for reduced motion. Presses scale (`0.97`), never delay.
- **Danger is soft.** A `danger` button is red text on a pale red, not a red slab —
  reject and cancel must be findable, never the loudest thing on a screen.
- **Checking signed-in screens without typing a password into a browser:** a Node script
  signs a demo account in with `SEED_PASSWORD` (as `verify:live` does), serves the
  session to `localhost` only, and the page writes it to `localStorage` under
  `sb-<ref>-auth-token`. No token passes through the tool transcript. The browser pane's
  phone emulation draws stale frames and mis-aims clicks; test at the pane's own width
  and measure desktop layout with `getBoundingClientRect` instead. **Since CAPTCHA went on**,
  that script can no longer sign in with a password: it mints a one-time link with the
  service key and redeems it at `/verify`, like `verify:live`.

**The logo (2026-09-30)**, from the brand sheet "Canteza Logo.pdf": the C is a plate — a
thick ring seen from above — and the dot in its opening is the room the order is going to;
saffron on stone. How it is built, so the next change is one edit:

- **One definition, `LOGO` in `packages/shared/src/logo.ts`**, measured from the sheet's
  1024 master: ring centre, radius and stroke, a 90° opening, the dot, the tile's corner.
  Rendered back and compared with the master, it differs on 0.21% of pixels (the edges).
  At 32 px and below the stroke and dot thicken by 15%, the sheet's own rule.
- **The phone and web app draw it from Views** (`logo.tsx`): a bordered circle is the
  plate, a 45°-turned square in the tile's colour cuts the opening, two circles are the
  round ends, one more is the room. No image files and no `react-native-svg` (which would
  mean a native rebuild), sharp at every size, colours from the theme — saffron tile in
  light, the brighter saffron on the dark tile in dark, as the sheet asks. Used on the
  sign-in panel (reversed: white tile on saffron), and in `BrandBar` — the lockup plus the
  screen's actions, the sheet's nav bar — on each role's first screens: student Home, the
  counter's board and menu (tagged COUNTER), the delivery queue (tagged DELIVERY), like
  the admin's ADMIN badge. Screens further in keep their back button. On a 320px phone the
  tag wraps under the name rather than running under the buttons (measured).
- **The admin draws it as inline SVG** (`apps/admin/src/app/logo.tsx`), the name in Plus
  Jakarta Sans via `next/font` (self-hosted at build time), colours in `globals.css`.
  Stacked on the sign-in page, horizontal in the dashboard header.
- **Every icon file is rendered from `logoSvg()`** by `npm run brand:assets` (in
  `apps/mobile`), which also runs `web:icons`: the square app icon (the OS rounds it), the
  Android adaptive foreground/background/monochrome (glyph inside the safe two thirds;
  the monochrome is also the notification icon), the favicons (thickened), a reversed
  splash mark, the web manifest icons (now also `maskable`), and the admin's `icon.svg`
  and `apple-icon.png`. `sharp` is a root devDependency for it. The script imports the
  TypeScript source directly (Node's type stripping). `logo.test.ts` fails if a committed
  SVG or the web page's boot splash drifts from the definition.
- **The web page shows the mark while its 5 MB bundle downloads** — an inline SVG inside
  `#root` in `public/index.html`, which React replaces on its first render.
- **Live since `dc8a617`** on both sites: every served logo file is byte-identical to the
  repo, and the relayed production pages showed the reversed mark on sign-in, the lockup
  on Home, and the admin's login and dashboard header (signed in), with no console errors.
- **Not done:** the phone's native splash screen (`expo-splash-screen` is not installed;
  `assets/splash-icon.png` is ready for it), and the new app icons reach a phone only with
  the next EAS build. Empty states still use their emoji.

Four decisions worth not re-litigating:

- **`Screen` owns the keyboard.** Six screens took text input and none handled it; the
  counter's menu could not reveal its input at all, because that `Screen` does not
  scroll. It is now handled in one place: `KeyboardAvoidingView` (iOS padding only —
  Android resizes its own window via `softwareKeyboardLayoutMode: "resize"`), plus
  `reveal()`, which measures the focused input with `measureInWindow` against the live
  keyboard height and scrolls exactly the overlap. **No pixel constant anywhere**, so
  nothing is tuned to one handset. A `Field` registers itself on focus; the keyboard
  _event_ is the trigger, not a `setTimeout` that loses the race on a slow device.
- **`Screen` takes a `footer`** — the sticky action area, outside the ScrollView so it
  never scrolls away and inside the KeyboardAvoidingView so it rides above the keyboard.
  Cart, checkout, home, the canteen menu and the delivery detail all use it.
- **`Thumb` renders nothing without a URL.** `image_url` exists on `menu_items` and
  `canteens` but `seed.sql` sets it **zero times**, so every row in the live database
  has null. Reserving a square for a photo that does not exist is a list of empty
  boxes, so the row gives the space back to the name instead, and a photo added later
  simply appears with the text reflowing around it. `fallback="initial"` opts into a
  tinted initial where absence would read as a fault. A counter adds a photo from
  `(canteen)/menu.tsx`; the admin already had the field.
- **`VegMark`, not 🟢/🔴.** A red dot and a green dot are the same dot to a red-green
  colourblind student, so the mark is a bordered square that also carries a label —
  colour never carries the meaning alone.

**Ratings and ETAs** come from `canteen_stats`, and the one thing to know about it is
that it is **deliberately not `security_invoker`** — the opposite call to
`revenue_by_canteen_day`, for a stated reason. `orders_read` limits a student to their
own orders, so an invoker view would compute each student a private median from their
own handful of orders, and a new student would see no ETA at all. A kitchen's speed is
a property of the kitchen. That is only safe because **every column is an aggregate**;
`canteen-stats.test.ts` pins the column list so adding a per-order one fails loudly.

`verify:live` §8 is where that bet is settled with real sign-ins: two students read the
view and must see **identical** numbers, which anywhere else in this file would be a
leak and here is the requirement.

**A median of 0 means scripted, not fast.** On the live project the demo orders are
driven by `seed-users.mjs` and `verify:live`, which move an order from accepted to
ready in milliseconds — so `median_prep_minutes` reads 0 over a healthy sample.
`estimatedMinutes()` requires a median strictly above zero before it trusts one, so
those canteens quote the default instead. Real kitchens will populate it; a zero is
never worth showing.

The prep figure is the **median** of `accepted → ready` over 30 days: the median so the
order nobody marked ready until closing does not drag it, and that window so a canteen
that got faster is judged on how it cooks now. `estimatedMinutes()` in `config.ts` adds
the walk and rounds up to the nearest five, falling back to a default below
`minPrepSampleSize` — a median of three orders is an anecdote, not a promise.

**The counter's tab badges** come from `countOrdersByStatus`, which selects the
`status` column alone for every live status and groups the rows client-side — one
request rather than four `head: true` counts, and a payload of a few bytes per
in-flight order. It passes no `canteen_id`, exactly like `listCanteenOrders`, because
`orders_read` already scopes a canteen account to its own canteen (rule 15); proven
live, where a rival canteen's identical query returns only its own orders. **"Done" is
not counted** — every order ever finished grows without bound and tells the counter
nothing they can act on, and a badge exists to say "look here now". A zero shows no
badge at all rather than a row of noughts.

**Search** is `searchMenuItems` in `catalog.ts`. `menu_items_read` already lets any
signed-in student read any active item campus-wide, so it needed no policy, no view
and no migration. The user's wildcards are **stripped, not escaped**: checked against
the live project, `ilike` with `%Mag\%i%` returns exactly what `%Mag%i%` returns, so
PostgREST does not pass the backslash through as an ESCAPE — leaving them in means a
two-character search for `%a` quietly matches the whole menu.

## Environment — three files, not one

`.env.example` documents all of it, but the layout is the part worth knowing before you
go looking for a bug that isn't there. **Next and Expo each load env files from their own
package directory and neither walks up to the monorepo root**, so a single root `.env`
configures the scripts and leaves both apps with nothing. Verified directly rather than
assumed: `@next/env` loading from `apps/admin` with a root `.env` present returns zero
files, and `@expo/env` from `apps/mobile` does the same.

| File                    | Read by                        | Holds                                     |
| ----------------------- | ------------------------------ | ----------------------------------------- |
| `.env`                  | `verify:live`, `db:seed:users` | `SUPABASE_URL`, anon key, **service key** |
| `apps/admin/.env.local` | `next dev`, `next build`       | `NEXT_PUBLIC_SUPABASE_URL` + anon key     |
| `apps/mobile/.env`      | `expo start` (`dev:mobile`)    | `EXPO_PUBLIC_SUPABASE_URL` + anon key     |

All three are gitignored, so a fresh clone has none of them. `next dev` printing
`Environments: .env.local` is the check that the admin one is wired up.

Both npm scripts that need the root file pass node's `--env-file=.env`, so it is read
automatically; a variable already exported in the shell still wins over the file. It is
`--env-file`, not `--env-file-if-exists`, because that flag arrived in Node **v22.9.0**
and `engines` here is `>=22`, which admits 22.0–22.8.

**Node 22 is the floor, not 20** (raised 2026-09-29). supabase-js 2.116 throws "Node.js
detected but native WebSocket not found" when a client is created on Node 20, so
`auth.test.ts` failed there and **CI was red from 2026-09-26 (`f876789`) until then** —
every run, unnoticed, while the local machine on Node 24 stayed green. The whole suite
passes on 22.

**`EXPO_PUBLIC_*` must be written out in full, never `process.env[name]`.** Expo
inlines them with a Babel transform that rewrites the literal text
`process.env.EXPO_PUBLIC_FOO` at build time — a static substitution, so a computed
access is invisible to it. The trap is that a computed access works fine in
development, because `expo start` injects a populated `process.env` object at runtime;
a production `expo export` ships no such object. This app shipped exactly that bug: a
release would have read `undefined` for both credentials, fallen through to the
unsubstituted `$SUPABASE_URL` in `app.json`, and thrown "Supabase URL and anon key are
required" at module load — crashing on launch while every dev build was fine. Nothing
in `verify` could see it, because the source is valid either way and the difference
lives in the bundler. `apps/mobile/test/env-inlining.test.ts` now pins it on the source
text; the real proof is grepping the exported Hermes bundle for the project ref, which
was absent before the fix and present after.

**The service role key belongs in the root `.env` and nowhere else.** `createCampusClient`
refuses one, and it has to recognise two shapes to do it: a legacy key is a JWT with
`service_role` written in its payload, while a newer `sb_secret_...` key is opaque and
only its prefix gives it away. `sb_publishable_...` is the new anon key and is the one
that belongs in a bundle.

## Rules this codebase follows

1. **Money is integer paise, always.** Never a float. Format only via `formatPaise`.
2. **Business rules live in `packages/shared` and in SQL — never in a component.**
   The SQL copy is authoritative; the TypeScript copy exists for pre-submit UX.
3. **Clients never write `orders.status`.** There is no grant. All movement goes through
   `transition_order` / `claim_delivery`.
4. **Never trust the client** for prices, role, payment status, order ownership or totals.
   `place_order` re-reads prices from the database and ignores anything the client sent.
5. **Every transition is a conditional update** (`WHERE status = <expected>`). Zero rows
   updated means someone else won the race — surface it, don't retry blindly.
6. **Orders snapshot what was charged.** Item name and unit price are copied into
   `order_items` at purchase. Never join to `menu_items` for a historical price.
7. **Every new table gets RLS and a policy in the same migration.** Two tests enforce this.
8. **Anything that must never be client-writable is withheld at the `GRANT`**, not the
   policy — policies cannot restrict columns. This only works because
   `..._harden_default_privileges.sql` first revokes the blanket grants Supabase hands
   `anon`/`authenticated` on every table in `public`. **Change privileges in that
   migration**, not in the earlier RLS one, which the revoke supersedes.
9. **Realtime invalidates TanStack Query keys**; it never patches component state directly.
10. **Errors surface as `AppError`.** SQL raises `'CODE: detail'`; `toAppError()` parses the
    prefix. A new code in SQL needs the same code in `errors.ts`.
11. **Wrap helper calls in RLS policies**: `(select public.is_admin())`, not
    `public.is_admin()`. Unwrapped, Postgres re-evaluates it per row.
12. **A cancelled order consumes nothing** — no coupon, no payment. Whatever
    `place_order` reserved, the terminal transition releases.
13. **Never hand-edit `database.types.ts`.** Change a migration, run `npm run db:types`.
14. **No literal colours or spacings in a component.** Read tokens from `useTheme()`
    (mobile) or the CSS variables in `globals.css` (admin).
    14a. **Compose from `ui.tsx` and `patterns.tsx`; never re-invent a primitive locally.**
    Three screens had each grown a private quantity stepper, chip and back button.
    A pattern that exists once is a pattern that stays consistent — and `Screen` is
    the only place the keyboard is handled, so a new form cannot forget it.
15. **Role routing is ergonomics, not security.** RLS is the boundary. A patched
    client gets a different menu and no extra data.
16. **Never write the product name in a component.** Import `BRAND` from
    `@canteza/shared`. The product is Canteza; `CampusEats` was the placeholder in the
    original brief and now appears nowhere in the repo.
17. **The cart stores item ids and quantities only.** No prices, no names, no total.
    `place_order` re-reads every price server-side, so a price here would be a lie
    waiting to happen.
18. **Action buttons come from `nextStatusesFor(status, actor)`**, never a hand-written
    list, so a screen cannot offer a move the database would refuse.
    18a. **Never navigate during render, and never key that navigation on data a
    successful action mutates.** `router.replace`/`push` belongs in an event
    handler or a `useEffect`, never in the body of a component — it updates the
    navigation container mid-render and React 19 reports "Cannot update a component
    while rendering a different component". `checkout.tsx` redirected an empty cart
    this way from Phase 4 and **Expo Go never surfaced it**; the development build
    reported it on the first open.

    The same line had a second, quieter symptom: `submit()` clears the cart on its way
    to the order tracker, so **any** guard that watches the cart — the render-time one,
    or an effect keyed on `[cartEmpty]` — sees it empty and replaces the tracker with
    the home screen. A student places a real order and never sees it. The guard now
    reads `useCart.getState()` inside an effect with an empty dependency array, so
    nothing watches the cart after mount and clearing it cannot navigate at all.
    **Prefer removing the race to winning it.**

    A debugging lesson came with it, worth more than the fix: three rounds were spent
    reasoning about React batching and ref timing to explain why a fix "did not work"
    on the device, when the device had simply never loaded it — a development build
    serves a cached bundle until it is reloaded. **Before theorising about why a fix
    failed, prove the fix is running.** A single `console.warn` at the top of the
    changed function settles in seconds what an hour of reading cannot.

19. **Route groups do not appear in the URL.** `app/(student)/home.tsx` is `/home`.
    Give each role group a distinct filename — three `index.tsx` files would all
    resolve to `/`.
20. **Vertical slices.** A working end-to-end path beats twenty half-built screens.

## Decisions already made (do not re-litigate without a reason)

| Area            | Choice                                                        | ADR |
| --------------- | ------------------------------------------------------------- | --- |
| Mobile          | One Expo app, `expo-router` route groups per role             | 001 |
| Backend         | Supabase; business logic in Postgres `SECURITY DEFINER` funcs | 002 |
| Database        | Postgres; integer paise; snapshotted order history            | 003 |
| State           | TanStack Query (server) + Zustand (cart only)                 | 004 |
| Order lifecycle | 9 statuses, explicit transition table                         | 005 |
| Delivery        | **Canteen-scoped** partners; claim from own canteen's queue   | 008 |
| Revenue         | ₹2 of the ₹10 delivery fee. Nothing on food.                  | 008 |
| Payments        | COD first; Razorpay behind server-side webhook verification   | 006 |
| DB testing      | PGlite in-process Postgres; no Docker required                | 007 |
| Admin           | Next.js App Router on Vercel                                  | —   |
| API style       | PostgREST for reads, RPC for rule-bearing writes. No GraphQL. | 002 |

Departures from the original brief, all argued in the ADRs:

- `out_for_delivery` merged into `picked_up` — one tap, not two (ADR 005).
- Delivery is **canteen-scoped**, not a campus-wide pool: external couriers cannot enter
  campus, so each canteen employs its own staff (ADR 008, supersedes part of ADR 005).
  `delivery_partner.canteen_id = order.canteen_id` is guaranteed by a **composite foreign
  key**, so a cross-canteen assignment is unrepresentable, not merely rejected.
- A canteen can deliver its own order (`ready → delivered`) when no partner is on shift.
- Role comes from a `security definer` lookup, **not** a custom JWT claim — a claim needs
  an auth hook outside the migrations and goes stale until refresh (architecture.md §4).
- `campus_id` / `delivery_batch_id` were **not** added. A column with one possible value
  buys nothing; both are one-line `alter table`s when actually needed.
- Notification rows store `(audience, status)`, not text. Wording is rendered client-side
  from `notifications.ts` so in-app and push cannot drift.

## Known gaps

- **Auth settings only the dashboard can change** (no tool here reads or writes them):
  - **Minimum password length / required characters** — set 8 and "letters and digits"
    to match `validatePassword`; a direct API sign-up otherwise gets GoTrue's floor of 6.
    Per Supabase's docs, an existing user whose password falls short can still sign in.
  - **Leaked-password protection** — the advisor reports it off, and Supabase's docs say
    it is a **Pro-plan feature**, so it cannot be switched on while the org is on Free.
  - **CAPTCHA** — **live since 2026-09-30 (Cloudflare Turnstile, commit `769621a`).**
    Proven on production: a password sign-in with no token answers `captcha_failed` ("no
    captcha_token found"), and one with Cloudflare's dummy test token is rejected by
    Cloudflare ("invalid-input-response") — before any password is looked at.
    `verify:live` passed 97/97 afterwards, through `signInPastCaptcha`. Both deployed
    sign-in pages, relayed byte for byte through localhost with their own CSP (the browser
    pane blocks remote scripts), rendered the widget with no console error; the admin's
    submit stays disabled until it answers. The phone needs a new EAS build to sign in.
    **The scratch attack script signs in with a password and would now need the same
    link fallback.** Before this: Once on, GoTrue
    refuses every sign-in and sign-up without a valid token, so the rollout order in
    `apps/mobile/WEB.md` §5 is the whole safety: site key into the builds and deployed
    first, the Supabase switch last. How it is put together:
    - **Off unless a site key is set** (`EXPO_PUBLIC_TURNSTILE_SITE_KEY`,
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY`): no key, no widget, no token — today's behaviour.
    - **`useCaptcha()`** (`src/components/captcha.tsx`) is the one hook both auth screens
      use: `ready` gates the button, `reset()` runs after **every** attempt, because a
      token is good for one request. Metro picks `turnstile.web.tsx` (Cloudflare's script,
      loaded on first use; CSP allows `challenges.cloudflare.com`) or `turnstile.tsx` (a
      WebView borrowing `canteza-mobile.vercel.app` as its hostname). The admin login has
      its own copy (`src/app/login/turnstile.tsx`).
    - **Sign-up no longer signs in a second time.** With "Confirm email" off, `signUp`
      already returns a session (`{ signedIn }`); the old `signUp` + `signIn` pair would
      have needed two tokens.
    - **`react-native-webview` is loaded lazily**, like Razorpay: its TurboModule is
      fetched with `getEnforcing` at import, which throws in any build made before it was
      added. `test/turnstile.test.ts` pins that, the message parser, the page and the CSP.
      The phone needs a **new build** to sign in once CAPTCHA is on.
    - **Scripts:** a script cannot solve a CAPTCHA, so when GoTrue refuses a password
      sign-in for that reason `verify-live.mjs` and `seed-users.mjs` mint a one-time link
      with the service key and redeem it at `/verify` (not CAPTCHA-protected). Both paths
      were run against the live project while CAPTCHA was still off; the service key never
      queries data in `verify:live`.
    - **Proven in a browser** on the production web build with Cloudflare's always-pass
      test key, under the real CSP: the widget loaded with no violations; sign-in sent
      `gotrue_meta_security.captcha_token` and a fresh token replaced the spent one; sign-up
      made **one** request carrying the token. (`fetch` was stubbed, so nothing left the
      page.) The admin build compiled with the key inlined; its login was not clicked
      through. **Not yet proven:** a real key with the Supabase switch on.
    - **The real widget is set up (2026-09-30):** site key `0x4AAAAAAFKJBycg8MVUWL8b`
      (public) is a Production variable on both Vercel projects, in all three `eas.json`
      profiles and in both local env files. A local build with it rendered Cloudflare's
      challenge on `localhost` with no Turnstile error — the key and hostname are
      accepted. (The challenge itself was not solved: that is for a person.)
    - **A widget that cannot run does not lock the form.** An old phone build without the
      WebView module, or a browser blocking Cloudflare, submits without a token and
      GoTrue decides — fine while the switch is off, `CAPTCHA_FAILED` after. Proven by
      serving the build with Cloudflare removed from the CSP: the notice showed, the
      button stayed usable, the request carried no token.
  - **Realtime "private channels only"** — the app uses no broadcast channels, so anyone
    holding the public key can broadcast on one; harmless to the data, noise at worst.

- **An account that has ordered cannot be deleted, on purpose.** `orders.student_id`,
  `orders.delivery_partner_id` and `order_status_history.actor_id` reference `profiles`
  with no `on delete` rule, so the dashboard's "Delete user" fails with "Database error
  deleting user" (seen 2026-09-29 on the web test account). Orders are the money record;
  a deleted student must not take them along. **Suspend instead** (admin → Accounts,
  `admin_set_profile_active`) — `getIdentity` refuses an inactive profile at sign-in.
  Test data can be removed by deleting that account's orders first (everything under
  `orders` cascades), then the user. There is no "delete my account" flow for students
  yet; when one is needed, it should anonymise the profile rather than delete it.

- **Student sign-up by college email, with a code (built 2026-09-30, not yet switched on).**
  One mailbox, one account: a student signs up with an `@mnnit.ac.in` address and enters
  the code emailed to it. **Until the dashboard steps in `apps/mobile/WEB.md` §6 are done,
  "Confirm email" is still off** (`mailer_autoconfirm: true`, 2026-09-29) and nothing
  server-side enforces the domain — only the form does. Off because Supabase's built-in
  sender delivers only to the project's team, so **custom SMTP comes first**. How it fits:
  - **The rule is `is_campus_email()`** (`campus_email_signup` migration), mirrored in
    `packages/shared/src/campus-email.ts`; `supabase/test/campus-email.test.ts` runs both
    over the same addresses (proven to fail when the SQL allowed `+`). Exactly the domain,
    no subdomains, **no `+tag`**: the college mail is Google Workspace (its MX records are
    Google's, checked), where `name+1@` is a second address on one mailbox.
  - **Enforced by the "Before User Created" auth hook**, `hook_before_user_created`, which
    GoTrue calls on public sign-up and invites but **not** on the admin API (read in its
    source: `signup.go`, `invite.go` call it, `admin.go` does not). That is the staff
    path: canteen workers and delivery partners have no college mailbox, so the admin
    creates them (dashboard "Add user", or `seed-users.mjs`). Invites to them fail.
  - **A college account keeps a college address** (trigger `keep_campus_email` on
    `auth.users`, on `email` and `email_change`); otherwise changing it to a personal
    address frees the mailbox for a second sign-up. Staff accounts are untouched.
  - **Verifying also sets the password** (`verifySignUpCode`). GoTrue answers a second
    sign-up for an unconfirmed address by re-sending the code **without** changing the
    password (`signup.go`), so whoever signed up first chose it — maybe not the mailbox's
    owner. The code proves ownership; setting the password the owner typed makes the
    account theirs. `same_password` is the normal answer and is ignored.
  - **The app** (`email-code.tsx`, used by sign-up and by sign-in when GoTrue says "Email
    not confirmed"): the code field, verify, and "send a new code" after 60 s. `/resend`
    is CAPTCHA-guarded (`/verify` is not), so the widget mounts only once resending is
    possible. The email is a **code, not a link** (`supabase/templates/confirmation.html`).
  - **Proven in a browser** against the production build with Cloudflare's test key and a
    local stand-in for Supabase Auth (nothing reached the live project): a Gmail address
    is refused before any request; the college one is sent lower-cased with its CAPTCHA
    token; a wrong code shows `CODE_INVALID` and sets no password; "send a new code"
    carries a fresh token; sign-in to an unconfirmed account opens the code step. **Not
    yet proven:** a real email arriving, and the hook refusing on the live project.
  - Existing accounts are unaffected: sign-in is not restricted. Site URL and redirect
    URLs are set to the two Vercel addresses.

- **The unpaid-order sweep is scheduled outside the migrations.** `pg_cron` is an
  extension a project enables rather than something a migration should assume, so the
  job (`expire-unpaid-orders`, every 5 minutes) lives only in the live project — a fresh
  project needs it scheduled again (`supabase/functions/README.md`). **Proven live on
  2026-09-27:** an unpaid prepaid order placed at 05:20:55 UTC was left alone by the
  05:35 run and cancelled by the 05:40 run as `system`, payment `failed` / "abandoned at
  checkout", student told, counter never paged. Check it with
  `npx supabase db query --linked "select * from cron.job_run_details order by start_time desc limit 5"`.
- **No admin page for coupons.** `coupons_admin` lets an admin do anything to the table
  and nothing in the dashboard does; codes are created in SQL. A page, no migration.
- **No student search.** context.md §2 promises browse **and search**; `home.tsx` lists
  canteens with no search input, and there is no cross-canteen dish search.
- **The mobile app has never run against the live project.** Every admin page has now
  been driven in a browser against real data, but `apps/mobile` has only ever been
  bundled, not run — no student has placed an order from a device, and the realtime
  tracker has only been proven from Node. That needs Expo on a phone or simulator.
  The counter's menu screen is in the same position: the **data path underneath it is
  proven live** (`verify:live` §5, seven checks through real canteen and student
  sign-ins) and it compiles into the Android bundle, but nobody has tapped the buttons.
  Running it needed a device. That changed on 2026-09-29: the app now also targets the
  web (see "The web app"), so `react-native-web` and `react-dom` are real dependencies.
- PGlite is single-connection, so the race tests verify the **guard** sequentially (A claims,
  B is refused) rather than firing two transactions in parallel. The atomicity is Postgres's
  own, but when Docker is available, re-run the claim scenario against `supabase start` with
  two connections. Documented in [`supabase/test/README.md`](./supabase/test/README.md).

## Phase 4 screens

```
app/(student)/home.tsx          canteen list, active-order banner, cart banner
app/(student)/canteen/[id].tsx  menu, add to cart, cross-canteen confirm
app/(student)/cart.tsx          live prices, checkOrderPlacement blocker
app/(student)/checkout.tsx      address (prefilled), place_order, idempotency key
app/(student)/order/[id].tsx    live tracker, cancel while pending
app/(canteen)/orders.tsx        four-tab board, buttons from the state machine
```

## Phase 5 screens

```
app/(delivery)/deliveries.tsx     shift switch, carrying-now list, canteen's queue
app/(delivery)/delivery/[id].tsx  destination large, cash to collect, state-machine buttons
app/(delivery)/history.tsx        completed deliveries + counts (never a rupee figure)
```

**The shift rule worth remembering:** `is_online` hides the queue and refuses new
claims, but never touches an order already in hand. `orders` matches those by
`delivery_partner_id = auth.uid()` and `transition_order` resolves the actor the same
way, so going off shift cannot strand food someone is carrying.

## Verifying against a real database

**This has been done.** A hosted project is linked by `.env` (gitignored), the schema and
seed are pushed, and `npm run verify:live` passes 97/97. Seven of §11's ten checks need
`create-payment` deployed; without it they are skipped and the script says so. Re-run after any migration.

`scripts/verify-live.mjs` uses the **anon key and real sign-ins only** — never the service
role key, because a script that can bypass RLS cannot test it. That is the difference from
`seed-users.mjs`, which is server-side and does bypass it.

Four defects were only ever findable this way, all fixed:

1. **`service_role` had no privileges on any of our tables.** Every server-side call
   returned 42501. `harden_default_privileges.sql` said service_role was "left alone on
   purpose" — but left alone meant never granted, and Supabase's bootstrap grants do not
   reach tables a later `db push` creates. The PGlite harness had been _modelling_ a
   default grant that does not exist, so the suite was green while the platform was
   broken. Fixed in `..._service_role_grants.sql`; the harness no longer pretends, and
   `privileges.test.ts` pins it.
2. **`seed-users.mjs` created delivery partners with no canteen.** Stale since ADR 008
   made delivery canteen-scoped; `delivery_partners.canteen_id` is NOT NULL. The harness
   never exercised this file, so nothing caught it.
3. **The seeder could only run between 08:00 and 22:00 IST**, because `place_order`
   refuses a closed canteen and `seed.sql` sets real hours. It now opens the canteens for
   the duration and restores them in a `finally`, the same trick `seedCampus` uses.
4. **A realtime race, in the verification script itself.** `SUBSCRIBED` means the channel
   joined, not that the `postgres_changes` filter is registered with the replication
   worker. An INSERT in that gap is never delivered, which looks exactly like a broken
   publication. The script now settles before acting.

### What the browser pass added

Driving all seven admin pages against live data closed the last unverified claims, and
found two more defects that no offline test could reach:

5. **`seed-users.mjs` was not re-runnable.** `place_order` is idempotent and hands back
   the _existing_ order, so a second run replayed transitions against an already-delivered
   order and died on `INVALID_TRANSITION: delivered -> accepted`. It now finds where each
   order already sits on its own path and only walks the remainder, which also repairs a
   run that failed halfway. The review insert needed `on_conflict=order_id` for the same
   reason.
6. **The overview's "Next" card still advertised Phase 6 as unbuilt**, months of work
   after the fact. Replaced with a short guide to where each page is.

Proven in the browser rather than reasoned about: the `profiles!orders_student_id_fkey`
embed and the `profiles`/`hostels` embeds all resolve; the `or=(...)` search matches on
both `code` and `room` and survives a `#` through URL encoding; `is_within_hours` reports
Night Canteen open at 00:05 IST while every other canteen reads closed; and the campus day
boundary is right where it matters — an order backdated to 00:30 IST on the 20th
(19:00 UTC on the 19th) is excluded from the 19th and included in the 20th, the opposite
of what a naive UTC cutoff gives. `apps/admin/test/order-filters.test.ts` now pins that
case as a regression test.

### First-time setup

`supabase start` needs Docker, which this machine does not have — but **`supabase db
push` does not** (it fails with a connection error, not `LegacyDockerRunError`, unlike
`gen types`). So a free hosted project verifies the whole stack with nothing installed:

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push --include-seed        # migrations + seed.sql
npm run db:seed:users                      # accounts + demo orders via the real RPCs
```

`db:seed:users` needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment
and refuses a hosted URL unless `ALLOW_REMOTE_SEED=1` is set. It drives `place_order`,
`transition_order` and `claim_delivery` over HTTP, so a clean run proves PostgREST, Auth
and the RPC surface end to end. Realtime still needs a device or browser watching.

## Phase 6 screens (admin)

```
app/(dashboard)/layout.tsx        admin gate + nav, written once for every page
app/(dashboard)/page.tsx          overview counts (was app/page.tsx)
app/(dashboard)/orders/page.tsx   search + status/canteen/date filters, 100 newest
app/(dashboard)/orders/[id]/      one order: people, address, items, money, trail
app/(dashboard)/canteens/         list with live open/closed, disable/enable
app/(dashboard)/canteens/[id]/    edit: name, hours, min order, pause switch
app/(dashboard)/canteens/new/     create; the canteen starts disabled
app/(dashboard)/canteens/canteen-fields  the form both of them render
app/(dashboard)/canteens/staff-section   who works this counter, attach/detach
app/(dashboard)/canteens/delivery-section who delivers for it, onboard/retire
app/(dashboard)/students/         every account: search, role, suspend/restore
app/(dashboard)/hostels/          buildings and their blocks, edited in place
app/(dashboard)/analytics/        revenue per canteen over a campus date range
src/lib/people-filters.ts         account search + blocks text[], pure and tested
app/(dashboard)/canteens/actions  the first server actions in this repo
src/lib/order-filters.ts          URL -> query, pure and tested
src/lib/canteen-form.ts           FormData -> RPC args, pure and tested
src/lib/format.ts                 campus-time dates, status text, badge tone
```

**How the admin pages are built, and why** — settled when Phase 6 started, so later
pages match rather than inventing a second way:

- **Server components read; server actions write.** No `QueryClientProvider` in
  `apps/admin`, no client fetching, no admin module in `packages/api`. ADR 004's
  TanStack Query is the _mobile_ pattern; a dashboard that re-renders on navigation
  does not need a second copy of the data in a client cache.
- **Filters live in the URL, never in state.** A filtered view is then a link an admin
  can paste to someone, and the page stays a server component. The filter form is a
  plain `method="get"`, so it works with no JavaScript and needs no handler.
- **A search term is interpolated into a PostgREST `or=(...)` string**, which is the one
  place in this app where user input reaches a query expression rather than a parameter.
  `parseOrderFilters` reduces it to `[a-z0-9#-]` — a comma would start a new condition
  and `*` is the ilike wildcard. That is what `apps/admin/test/order-filters.test.ts`
  exists to hold down.
- **Dates are campus time, explicitly.** Vercel and Supabase both run UTC, so a bare
  `2026-09-19` bound would cut the day at 05:30 IST. `CAMPUS_UTC_OFFSET` in
  `packages/shared/config.ts` is the only place that offset is written.
- **A badge's tone comes from `statusTone()`**, never from a page. Delivered reads green,
  cancelled and rejected read red, anything still moving keeps the default — otherwise a
  scan list renders every outcome in the same orange.
- **A write goes through an RPC, and its outcome comes back in the URL.** Server actions
  here never `update` a table directly and never return state to a client component:
  they call a `security definer` function and `redirect` with `?error=` or `?saved=`.
  That keeps every admin page a server component and makes a failed save a link.
- **An aggregate view is `security_invoker`.** `revenue_by_canteen_day` runs with the
  caller's privileges, so `orders_read` scopes it: an admin sees the platform, a canteen
  sees only its own takings. A normal view runs as its owner and would have handed every
  caller the whole platform's money. `canteens_public` is deliberately the other kind —
  its own `where is_active` is the filter, and there is nothing private in it.
- **Nothing an admin does may lock the platform out of its own administration.** An
  admin cannot demote or suspend themselves — a sole admin doing either leaves no path
  back, since every route to `role` and `is_active` requires an admin. The database
  refuses both; the page also declines to render the controls on your own row.
- **The name search uses `.ilike()` on one column, not `or=(...)`.** Names contain
  spaces, and a space inside a PostgREST `or` group needs quoting rules that are easy to
  get wrong. One parameterised filter has no injection surface at all, and the cost is
  that phone is not searched in the same query.
- **A person is counter staff or a delivery partner, never both.** Each onboarding
  function refuses the other's rows (`ALREADY_DELIVERY_PARTNER`, `ALREADY_CANTEEN_STAFF`).
  Not tidiness: `transition_order` resolves the actor admin → canteen → delivery, so
  someone holding both acts as canteen on their own canteen's orders and could claim a
  delivery they can then never mark picked up. The guard must exist on **both** sides —
  it only had one until Phase 6 built the delivery UI.
- **Staffing works on a disabled canteen.** A canteen is created switched off so its
  people and menu go in first, so neither `admin_attach_canteen_staff` nor
  `admin_set_partner_canteen` may require `is_active` — only that the canteen exists.
- **A membership and a role are written together, or not at all.** `my_canteen_id()`
  reads `canteen_staff` and never looks at `profiles.role`: the row grants the data, the
  role picks the app. `admin_attach_canteen_staff` writes both, which is why
  `canteen_staff` has no client write grant either. Neither function will demote an
  admin who also works a counter.
- **A canteen is disabled, never deleted.** `canteens` now has no client INSERT or
  DELETE grant at all: creating goes through `admin_create_canteen` and retiring through
  `admin_set_canteen_active`. Deleting a canteen would cascade its staff and delivery
  partner rows and orphan `orders.canteen_id`, so the table simply does not offer it.
- **A mutating control is a `<form>`, never a `<Link>`.** The disable switch POSTs. A GET
  that changes state gets fired by any prefetcher that touches the page.
- **`proxy.ts` must live in `src/`.** This app has a `src/` directory, so Next looks for
  `src/proxy.ts` and silently ignores one at the package root — no warning, no error, the
  file simply never runs. It sat unregistered from Phase 3 until Phase 6 caught it: the
  login redirect never fired and, worse, the session was never refreshed. The build
  output printing `ƒ Proxy (Middleware)` is the check that it is wired up.
- **Vercel installs `apps/admin` alone, so it gets none of the root's devDependencies.**
  With the Root Directory set to `apps/admin`, `npm install` runs there and installs that
  workspace only — reproduced in a fresh clone: no `typescript` or `@types/node`, and
  `next build` stops with "Please install typescript and @types/node". Both are now the
  admin's own devDependencies, at the root's ranges so the lockfile reuses the same
  versions. The tests import `vitest`, root-only too, so `next build` type-checks through
  `tsconfig.build.json` (no `test/`); `npm run typecheck` still covers the tests with
  `tsconfig.json`. **Anything `next build` needs must be declared in
  `apps/admin/package.json`.**

## Phase 7 screens

```
admin   app/(dashboard)/canteens/[id]/menu/    add, edit, retire, restore a dish
admin   app/(dashboard)/support/               the complaints queue: status + resolution
admin   src/lib/menu-form.ts                   FormData -> a row, pure and tested
mobile  app/(canteen)/menu.tsx                 the counter's own menu
mobile  app/(student)/my-orders.tsx            order history
mobile  app/(student)/support.tsx              file a complaint, read the answer
mobile  app/(student)/order/[id].tsx           + rate, + reorder, + report a problem
mobile  app/(student)/canteen/[id].tsx         + a heart on every dish
mobile  app/(student)/home.tsx                 + the favourites strip
mobile  app/(student)/checkout.tsx             + the coupon field
api     catalog.ts     listCanteenMenu / createMenuItem / updateMenuItem
api     engagement.ts  reviews, favourites, coupons, tickets
shared  money.ts   parsePriceRupees            the price rule, both surfaces
shared  time.ts    formatCampusDateTime        campus time, both surfaces
shared  pricing.ts normaliseCouponCode         matches place_order's upper(trim())
```

**Two surfaces, one table, and they are not the same screen.** The admin page is for
stocking a canteen — categories, sort order, image, description — which happens once,
before anyone is posted to the counter. The counter's screen is built around the one
thing that happens during service: the samosas run out and someone says so in one tap.
So a dish collapsed on mobile shows its sold-out switch and nothing else, and the name
and price hide behind a tap. Adding a dish there asks for a name and a price only; the
rest is setup the admin already did.

`listCanteenMenu` is a separate query key (`queryKeys.canteenMenu`) from the student's
`useMenu`, because the same canteen id would otherwise cache the filtered list and the
full one over each other and whichever screen loaded second would show the wrong one.

**Order history is `my-orders.tsx`, not `orders.tsx`** — rule 19, met for real rather
than in the abstract. `(canteen)/orders.tsx` already resolves to `/orders`, so a second
`orders.tsx` in `(student)` would have been the same route, and a student tapping
through would have landed on the counter's board. It reads `listMyOrders`, which was
written in Phase 4 and had never had a caller. No student id appears in that query:
`orders_read` is what limits it, and `verify:live` §6 is where that is proven rather
than assumed.

`formatCampusDateTime` moved from `apps/admin/src/lib/format.ts` to
`packages/shared/time.ts` when the phone needed the same rule — the campus timezone is
applied in one place. The admin file re-exports it, so every import there is unchanged.

**Engagement is policy all the way down.** Ratings, favourites, coupon reads and
complaints are plain table writes with no RPC anywhere, because each already carries a
policy that says exactly who may write what. The strictest is `reviews_insert_own`,
which checks in SQL that the order is the writer's own _and_ delivered _and_ from the
canteen being rated — a `security definer` function would have restated that in a
second place and could drift from it. `verify:live` §7 is where that bet is settled,
with real sign-ins.

Four things worth keeping straight:

- **`favorites` gets an `insert`, never an `upsert`.** The table is nothing but its
  primary key, so it has no UPDATE grant — and PostgREST's upsert is
  `insert ... on conflict do update`, which asks for one and is refused with 42501. A
  duplicate key means the dish is already a favourite, which is the outcome wanted, so
  `addFavorite` swallows 23505 and nothing else.
- **The checkout does not show the discount.** `place_order` applies it — re-reading the
  coupon, checking the minimum and the per-student limit, capping it at the subtotal —
  so a figure computed on the phone would be a guess that disagrees with the receipt the
  moment a rule bites. The field sends a code; the order screen shows what was allowed.
- **Reorder copies ids and quantities, and nothing else** (rule 17), so it is charged at
  today's prices rather than the receipt's. Retired and sold-out dishes are dropped,
  because `place_order` re-reads every price from `menu_items` and a line pointing at a
  dish that is off the menu cannot be priced at all. The screen says so before you tap.
- **A student can file a complaint and read the answer, but never resolve it.**
  `support_tickets_admin` is the only UPDATE policy, so a student updating their own
  ticket filters to zero rows rather than erroring.

**Where this one departs from the Phase 6 pattern, and why.** Every other admin write in
this app goes through a `security definer` RPC, because `canteens`, `profiles` and
`delivery_partners` all withhold columns at the `GRANT` and a Postgres grant is per role
— an admin is `authenticated` like everyone else. `menu_items` withholds nothing: a price
is exactly what the counter is meant to write, and `menu_items_admin` /
`menu_items_own_canteen` already carry the WITH CHECK. So this is a plain table write,
the same call `hostels/actions.ts` makes and for the same stated reason. What was missing
was never the authorisation — it was any code at all that wrote the table.

Three things the page settles:

- **An item is retired, never deleted.** `order_items.menu_item_id` references it with no
  `on delete` clause, so Postgres refuses to remove anything anyone has ordered — the FK
  is kept on purpose (snapshot for display, FK for reorder and analytics). Retiring is the
  only retirement path, and `listMenu` filters `is_active`, so it leaves every menu.
- **Sold out and retired are different states.** `is_available` hides an item for today
  and keeps it on the menu — `listMenu` deliberately returns it so a student sees Maggi
  greyed out rather than silently absent. The item count badge counts the live ones.
- **Each item is a `<details>`.** A menu is a list to scan and occasionally one row to
  edit; 28 open forms would bury it. Native, so the page stays a server component.

## Next session: Phase 7

Phase 6 is finished — what it built and why is above. The five areas it covered, for
reference when extending them:

1. ~~**Orders**: search, filter, status history trail.~~ ✅ done
2. ~~**Canteens**: create, edit hours, disable.~~ ✅ done. A new canteen is created
   **disabled** and has no staff and no menu, so the admin adds both and then enables it
   from the list. Attaching a staff account is still missing — it belongs with the users
   page, because `canteen_staff_one_canteen` makes "attach" sometimes mean "move".
3. ~~**Delivery staff**: onboard, transfer, retire, restore.~~ ✅ done, as a section on
   the canteen's own page. A new posting starts **off shift** — the partner goes online
   themselves, and `is_online` is the one column on that table a client may write.
4. ~~**Students, hostels**: manage.~~ ✅ done. `/students` is every account, not only
   students — a role change is how someone becomes staff. Names and phones stay
   read-only: the grant permits writing them, but they are the person's own details.
   The admin app cannot see anyone's **email** — that lives in `auth.users`, which
   PostgREST does not expose — so people are identified by name and phone. If that is
   not enough to tell two students apart, the fix is a view or an RPC, not a client read.
5. ~~**Analytics**: revenue.~~ ✅ done, from `revenue_by_canteen_day`. **The formula this
   file used to state was wrong**: "subtotal + (delivery − platform)" ignores the
   discount and so overstates the canteen's take on any order with a coupon. What the
   canteen actually receives is `total_paise − platform_fee_paise`, because `total` is
   what the student paid. Discounts are reported as their own figure rather than netted
   into either side, since who funds them is still open (ADR 008).

Two things the orders page deliberately does not do: **no pagination** (100 newest, and
it says so when it truncates — add a cursor when a real dataset makes that bite), and
**no "you are here" in the nav**, because highlighting it would make the nav a client
component for one line of styling. The accounts page has the same 100-row ceiling.

**Phase 7 is done.** Menu management on both surfaces, order history, ratings, reorder,
favourites, coupons at checkout and complaints end to end — see Phase 7 screens above.
Both admin pages were driven in a browser against the live project; the mobile screens
have their data paths proven by `verify:live` §§5–7 but have never been tapped on a
device.

The shared piece worth knowing about: **`parsePriceRupees` lives in `money.ts`**, not in
either app. The rule it encodes is that `price_paise > 0` has to be checked _after_ the
conversion, because 0.004 is a positive number of rupees that rounds to zero paise — a
naive check on the typed value passes something the column rejects. The admin form and
the counter's text input ask the same question, so it is written once (rule 1, rule 2).

Two notes that outlived the work:

- **Coupon funding is settled: the canteen absorbs every discount**, including a code an
  admin issued; the platform's ₹2 of the delivery fee is never touched by one (ADR 008).
  The maths already worked this way — `total_paise` is net of the discount and
  `platform_fee_paise` is flat — so nothing in `place_order` or `revenue_by_canteen_day`
  changed when it was decided.
- **There is still no admin page for coupons.** A student can use a code and the
  checkout offers whatever `coupons_read` returns, but creating or retiring one is a SQL
  statement today. `coupons_admin` already grants an admin everything, so it is a page
  and no migration — it lands whenever someone needs to run a promotion.

**Still unverified:** `apps/mobile`. The database, the API layer and the whole admin
dashboard are proven against the live project; the Expo app is not. Run
`npm run dev:mobile` with `EXPO_PUBLIC_SUPABASE_*` set, sign in as riya@campus.edu (the
password is `SEED_PASSWORD` in `.env`), place an order, and watch it reach
main.canteen@campus.edu and vikram@campus.edu.

Keep `npm run verify` green, then update this file and `docs/roadmap.md`. **Do not
commit** — leave the work staged for review.
