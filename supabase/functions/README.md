# Edge Functions

Deno, not Node. That split is the only surprising thing in here, so it is worth being
explicit about what runs where.

| Path                      | Runtime   | Typechecked | Linted | Tested                        |
| ------------------------- | --------- | ----------- | ------ | ----------------------------- |
| `_shared/razorpay.ts`     | both      | ✅ yes      | ✅ yes | ✅ `supabase/test/razorpay-*` |
| `verify-payment/index.ts` | Deno only | ❌ no       | ❌ no  | ⚠️ logic mirrored, see below  |

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

## Deploying

Not deployed yet; it needs a Razorpay account first.

```bash
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=whsec_...
npx supabase functions deploy verify-payment
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform. The
function reads the service role key because `record_payment_result` is granted to
`service_role` alone — no client, mobile or web, may write to `payments` at all.

Then point a Razorpay webhook at
`https://<project-ref>.supabase.co/functions/v1/verify-payment` and subscribe to
`payment.captured` and `payment.failed`. Anything else is acknowledged and ignored —
including `payment.authorized`, on purpose, because authorised money is held rather
than taken and a kitchen must not cook for it.

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

Until that is scheduled the function exists, is tested, and simply never runs — an
abandoned prepaid order sits at `pending` exactly as it did before, which is untidy
rather than unsafe: `transition_order` still refuses to let a canteen accept it.
