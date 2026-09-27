# ADR 006 — Cash on delivery first, Razorpay behind a server-verified seam

Status: **accepted** · 2026-09-19

## Decision

Ship with **cash on delivery** as a real, fully-modelled payment method. Razorpay is the
second implementation of the same `payments` abstraction, and a payment reaches `success`
only when a server-side HMAC check of Razorpay's webhook passes.

`payments` is a separate table from `orders`, with its own state machine:

```
initiated → pending → success → refunded
     └──────────────→ failed → initiated (retry)
```

## Context

Campus food is overwhelmingly paid in cash or UPI at the door. Online payment is a
conversion improvement, not a launch requirement — but faking it, or bolting it on later
against a schema that assumed cash, both produce a mess. The brief is explicit: do not mark
an order paid because the frontend said so.

## Alternatives considered

1. **Razorpay from day one, no COD.** Forces a payment-gateway account, KYC and settlement
   plumbing before a single order is delivered, and excludes students without UPI set up.
   It also makes the first end-to-end test depend on a third party.
2. **A `paid: boolean` on `orders`.** Simplest possible thing, and wrong the first time a
   refund happens, or a payment is pending while the order is already delivered, or a
   student retries a failed payment. A refund is not "paid = false".
3. **A generic payment-provider interface with adapters now.** Speculative: there is one
   provider on the roadmap. The seam that matters is _where verification happens_, not an
   abstract `PaymentProvider` class. Built the seam, skipped the class.

## Why this shape

- **COD is a real payment state, not an absence of payment.** It starts `pending` and is
  settled by the partner marking the order delivered. That makes "money owed to us today"
  a query, not a reconstruction.
- **Payment status is independent of order status.** An order can be `delivered` with
  payment `pending` (cash in the partner's hand, not yet settled), and `refunded` weeks
  later. Coupling them would make both wrong.
- **The verification seam is the whole design.** The client's Razorpay callback is treated
  as a hint that triggers a refetch — nothing more. `payments.status` is written by the
  `verify-payment` Edge Function. The secret lives only in Edge Function environment
  variables; it never ships in an app bundle.

  **Correction, Phase 8.** This ADR originally described one signature. There are two,
  and they are not interchangeable — building the function revealed that the one named
  here is the wrong one for a webhook:

  - **Webhook** (what `verify-payment` actually verifies):
    `HMAC_SHA256(raw_request_body, RAZORPAY_WEBHOOK_SECRET)`, sent in
    `X-Razorpay-Signature`. The body must be hashed exactly as received; Razorpay's docs
    say "Do not parse or cast the webhook request body", because a JSON round trip
    re-orders keys and the bytes stop matching.
  - **Checkout callback** (the hint the app receives):
    `HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)` — a different message _and_ a
    different secret.

  The webhook is the source of truth precisely because it arrives whether or not the app
  is still running. A student who force-quits mid-payment produces no callback at all,
  which is why the order flow never waits on one.

## Trade-offs

- COD carries real-world cash-handling risk (partner reconciliation, students not paying).
  That is an operations problem for one campus, tracked by `payments` rows rather than
  solved in code. Settlement reporting is Phase 7.
- Online payment introduces a window where the order exists but payment is unconfirmed.
  `transition_order` refuses `pending -> accepted` while a non-COD payment is not yet
  `success`, raising `PAYMENT_UNVERIFIED`, so a canteen never cooks food nobody paid for.
  The order can still be rejected or cancelled in that state. **Closed in Phase 8:** `expire_unpaid_orders()`
  cancels an order abandoned at checkout, fails its payment and releases its coupon,
  writing the trail as actor `system`. It still has to be scheduled — see
  `supabase/functions/README.md` — because pg_cron is a project setting rather than
  something a migration should assume.
- Razorpay webhooks can arrive out of order or twice. The handler is idempotent on
  `provider_payment_id`, and `canTransitionPayment` rejects illegal moves like
  `refunded → success`.

## Consequences

- `payments` rows are created inside `place_order`, in the same transaction as the order.
- `packages/shared/src/payment.ts` holds the status list, the transition table and
  `initialPaymentStatus(method)`. Adding a provider means adding a value to
  `PAYMENT_METHODS` and an Edge Function — not touching the order flow.
- No client, mobile or web, may write to `payments`. RLS grants select-own only.
- Refunds in the MVP are recorded in the database and executed manually by an admin. A
  Razorpay refund API call can replace the manual step without a schema change.

## Addendum (Phase 8): the checkout

The seam held; three things were added to it rather than changed.

- **A second Edge Function, `create-payment`.** The sheet needs a Razorpay order and
  creating one needs the key secret, so the app asks the server with an order id and
  nothing else. It reads the amount from our own `payments` row. This does not weaken
  the rule above: `create-payment` arranges for there to be something to pay and never
  declares anything paid. `verify-payment` is still the only writer of `success`.
- **One Razorpay order per order, reused for every attempt.** A retry after a declined
  card goes back to the same Razorpay order, which accepts attempts until one is
  captured. `record_payment_result` therefore accepts `failed -> initiated -> success`
  while the order is still `pending` — a second card tried inside the same sheet
  arrives exactly that way, and was being dropped as a stale event.
- **`REFUND_REQUIRED`.** Money captured against an order that is already cancelled is
  kept on the row and reported, not dismissed. It is the first concrete case of the
  manual refund this ADR anticipated.

A prepaid order that is not yet paid is **not work**: `transition_order` refuses to
accept it (unchanged), `notify_order` no longer pages the counter for it, and the
counter's board hides it. All three use the same condition, `awaitingPayment` in
`packages/shared/src/payment.ts`.
