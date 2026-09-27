# Edge Functions

Deno, not Node. That split is the only surprising thing in here, so it is worth being
explicit about what runs where.

| Path                                 | Runtime   | Typechecked | Linted | Tested                                                 |
| ------------------------------------ | --------- | ----------- | ------ | ------------------------------------------------------ |
| `_shared/razorpay.ts`                | both      | ✅ yes      | ✅ yes | ✅ `supabase/test/razorpay-signature`                  |
| `_shared/checkout.ts`                | both      | ✅ yes      | ✅ yes | ✅ `supabase/test/razorpay-checkout`                   |
| `verify-payment/index.ts`            | Deno only | ❌ no       | ❌ no  | ⚠️ logic mirrored, see below                           |
| `create-payment/index.ts`            | Deno only | ❌ no       | ❌ no  | ⚠️ decisions tested; its I/O by `verify:live` §11      |
| `_shared/push.ts`                    | both      | ✅ yes      | ✅ yes | ✅ `supabase/test/push`                                |
| `_shared/notifications.generated.ts` | both      | ✅ yes      | ✅ yes | ✅ identical to `packages/shared`, by test             |
| `send-push/index.ts`                 | Deno only | ❌ no       | ❌ no  | ⚠️ decisions tested; only its 401 by `verify:live` §12 |

**"Typechecked" for `_shared/` was not true until the checkout landed.**
`supabase/tsconfig.json` listed only `test/**`, so `tsc -b` refused the import with
TS6307 and `npm run verify` failed on a clean checkout. `_shared/**` is in its
`include` now. Do not narrow it back.

`_shared/razorpay.ts` is written against **Web Crypto and nothing else**, so the exact
file the Edge Function imports is the file vitest imports under Node. A second,
Node-flavoured copy for testing would be a copy that can drift from the one actually
guarding the money.

The entrypoint cannot be: it imports from `jsr:` and uses the `Deno` global, neither of
which the TypeScript resolver or ESLint here can see. It is excluded in
`eslint.config.js` — only `*/index.ts`, deliberately, so `_shared/**` keeps full
linting and typechecking.

## What is proven, and what is not

`supabase/test/razorpay-webhook.test.ts` wires signature verification to
`record_payment_result` in the same order the handler does and asserts the same status
codes. It proves a forged webhook never reaches the database and a genuine one moves
the money exactly once.

It does **not** prove the Deno runtime, the deployment, or Razorpay's real traffic.
Those need a deploy and a Razorpay account, and until then nothing here should be
described as end-to-end verified.

## verify-payment

Razorpay's webhook, and per ADR 006 the only thing in the system that may declare a
payment successful.

The order of operations is the security property:

1. read the body as **text** — the signature is over the exact bytes, and
   `await req.json()` destroys them. Razorpay's docs say it outright: "Do not parse or
   cast the webhook request body."
2. verify `HMAC_SHA256(raw_body, RAZORPAY_WEBHOOK_SECRET)` against the
   `X-Razorpay-Signature` header, **before reading a single field**;
3. only then parse, and hand the outcome to `record_payment_result`, which re-checks
   the amount and the payment state machine regardless — a signature proves who sent a
   message, not that the message is sane.

Status codes matter more than usual, because Razorpay retries anything that is not 2xx:

| Outcome                                   | Status | Why                            |
| ----------------------------------------- | ------ | ------------------------------ |
| Paid, failed, duplicate, stale, ignored   | 200    | Handled — stop retrying        |
| Unknown order (webhook outran our commit) | 409    | Not an error; please come back |
| Bad signature                             | 401    | Never retry this               |
| Our own failure                           | 500    | Retry                          |

### Two signatures, which are not interchangeable

- **Webhook** — `HMAC_SHA256(raw_body, WEBHOOK_SECRET)`.
- **Checkout callback** — `HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)`.

Different message, different secret. `verifyCheckoutSignature` exists for the second
and is not used by this function: the app's callback is a hint to refetch and never a
claim that anything was paid. That is why a student force-quitting mid-payment loses
nothing — the webhook still arrives.

## create-payment

The Razorpay sheet can only be opened against a Razorpay **order**, and creating one
needs the key secret, which must never be in an app bundle. So the app sends
`{ orderId }` — nothing else, and never an amount — and this function:

1. authenticates the caller with `auth.getUser(token)`;
2. reads the order and its `payments` row with the service role and hands both to
   `decideCheckout`, which refuses anyone but the student who placed it (**404, not
   403**, so an order id's existence is never confirmed to a stranger), a cash order, a
   paid one, and anything no longer `pending`;
3. creates a Razorpay order for **the amount on our row** — or reuses the one already
   attached, because a Razorpay order takes further attempts until one is captured;
4. attaches it with `begin_razorpay_payment`, which returns the id actually in effect:
   if two taps raced, the first to attach wins and both sheets open on it;
5. returns the public key id, that order id and the amount.

It never declares anything paid. The sheet's success callback is a hint to the app to
start watching the order; only `verify-payment` moves money.

### What the checkout migration fixed on the way

`20260927100000_razorpay_checkout.sql`. Each is a way money and orders fall out of
step, and none was visible until a real sheet was in the picture:

- **A second card tried inside the same sheet was dropped.** Attempt one's
  `payment.failed` set our row to `failed`, and `failed -> success` is not in the state
  machine, so attempt two's capture came back `STALE_EVENT` — money taken, order never
  released. It is now `failed -> initiated -> success`, two legal moves, taken only
  while the order is still `pending`.
- **A cancelled order could be paid for.** `begin_razorpay_payment` now locks the order
  and requires `pending`.
- **Two taps could attach two Razorpay orders**, and paying on the first sheet produced a
  webhook for an id we no longer held. First writer wins.
- **The counter was paged for unpaid orders.** `notify_order` withholds the canteen's
  `pending` notification while a prepaid payment is short of `success`, and
  `record_payment_result` sends it the moment the money lands. The counter's board hides
  those orders by the same rule (`awaitingPayment` in `packages/shared`).
- **Nothing woke the screens when money landed.** `payments` is not in the realtime
  publication, so `record_payment_result` touches `orders.updated_at`, and every
  subscriber already watching the order refetches.

And one that was a gap rather than a bug: money captured against an order that is
already cancelled now returns **`REFUND_REQUIRED`**. The payment id is kept on the row,
`failure_reason` says a refund is owed, the student's order screen says so, and the
webhook logs it as an error. The refund itself is manual (ADR 006).

## Deploying

Four steps, all yours — each needs your Razorpay keys, which never pass through this
repo. **Test mode** keys (`rzp_test_...`) until the whole flow has been seen working.

**1. The migration.**

```bash
npx supabase db push
```

**2. The secrets.** Key id and key secret from Razorpay dashboard → API Keys. The webhook
secret is a value **you choose** when creating the webhook in step 4 — pick it now and
use the same string in both places.

```bash
npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx RAZORPAY_WEBHOOK_SECRET=xxx
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform. Both
functions read the service role key because `begin_razorpay_payment` and
`record_payment_result` are granted to `service_role` alone.

**3. Both functions, with the gateway's JWT check off.**

```bash
npx supabase functions deploy verify-payment --no-verify-jwt
```

```bash
npx supabase functions deploy create-payment --no-verify-jwt
```

`config.toml` says the same (`[functions.*] verify_jwt = false`); the flag is there so
it does not depend on which CLI version reads that file. It is not optional for
`verify-payment`: **Razorpay's webhook carries an HMAC signature and no Supabase JWT**,
so with the check on, the gateway answers 401 to every genuine webhook and no payment
ever completes. `create-payment` authenticates the caller itself with
`auth.getUser()`, which works whichever JWT signing keys the project uses.

**4. The webhook.** Razorpay dashboard → Webhooks → Add:
`https://<project-ref>.supabase.co/functions/v1/verify-payment`, the secret from step 2,
subscribed to `payment.captured` and `payment.failed`. Anything else is acknowledged and
ignored — including `payment.authorized`, on purpose, because authorised money is held
rather than taken and a kitchen must not cook for it.

**So payments must be captured automatically.** Check Razorpay dashboard → Account &
Settings → Payment capture → **Automatic**. With manual capture, Razorpay sends
`payment.authorized` and never `payment.captured`, and every order sits unpaid until
the sweep cancels it.

Then `npm run verify:live`. §11 exercises `create-payment` from real sign-ins: the
amount comes from our row, a second call reuses the Razorpay order, another student, the
canteen and a signed-out caller are all refused, and a cancelled order cannot be paid
for. Until it is deployed, §11 says its function checks were skipped.

## send-push

Delivers each new `notifications` row to the recipient's phones through Expo's push
service. It decides nothing about _who_ hears _what_: `notify_order` made that decision
when it wrote the row, and the inbox shows the same row. Push is a second delivery.

**The wording is a generated copy.** `orderNotification()` lives in
`packages/shared/src/notifications.ts`, and Deno cannot import it from there — Deno needs
an extension on every import, and deploy bundles from `supabase/functions`. So
`npm run functions:sync` writes `_shared/notifications.generated.ts`, and
`supabase/test/push.test.ts` fails if the copy is stale and checks every audience and
status renders identically through both. **Reword a notification → run
`functions:sync` → redeploy `send-push`.** Skip the last step and the lock screen says
the old thing while the inbox says the new one.

It is triggered by a **Database Webhook**, configured in the dashboard rather than a
migration because it carries this project's URL and a secret. It authenticates the call
with that secret in an `x-push-secret` header, compared in constant time. Every other
failure — no devices, an Expo error — answers 200 and is logged: the row is already in
the inbox, so a failed push loses nothing a retry would win back.

Devices Expo reports as `DeviceNotRegistered` (uninstalled, token rotated) are pruned from
`push_tokens` on the spot. Any other ticket error says nothing about the device, and it is
kept. **Receipts are not checked** — Expo's second, delayed confirmation that the phone
actually got it. At this scale the tickets are enough; that is the first thing to add if
pushes start going missing.

### Deploying send-push

1. `npx supabase db push` — the `push_tokens` migration.
2. Choose a long random value for the webhook secret, then:

   ```bash
   npx supabase secrets set PUSH_WEBHOOK_SECRET=choose-a-long-random-value
   ```

   ```bash
   npx supabase functions deploy send-push --no-verify-jwt
   ```

3. Dashboard → Database → **Webhooks** → Create: table `notifications`, event **Insert**
   only, type **Supabase Edge Functions** → `send-push`, method POST, and an HTTP header
   `x-push-secret` with the same value. Not Update: an update on this table is someone
   marking a notification read.

`EXPO_ACCESS_TOKEN` is optional and only needed if "enhanced push security" is switched on
for the Expo project.

## Scheduling the abandoned-payment sweep

`expire_unpaid_orders()` closes the gap ADR 006 left open. It is not scheduled by a
migration, because `pg_cron` is an extension a project enables rather than something a
migration should assume. Once enabled:

```sql
select cron.schedule(
  'expire-unpaid-orders',
  '*/5 * * * *',
  $$select public.expire_unpaid_orders(interval '15 minutes')$$
);
```

**Scheduled on the live project and proven there** (2026-09-27): an unpaid order was
cancelled by the first run after it turned 15 minutes old, as `system`, with the student
told and the counter never paged. On a fresh project, until it is scheduled, the function
exists and simply never runs — untidy rather than unsafe, because `transition_order`
still refuses to let a canteen accept an unpaid order.

`npx supabase db query --linked` reads `cron.job` and `cron.job_run_details` through the
Management API with your CLI login, so checking it needs no database password.
