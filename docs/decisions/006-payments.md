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
  `verify-payment` Edge Function, which recomputes
  `HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, RAZORPAY_SECRET)` and
  compares it to the signature. The secret lives only in Edge Function environment
  variables; it never ships in an app bundle.

## Trade-offs

- COD carries real-world cash-handling risk (partner reconciliation, students not paying).
  That is an operations problem for one campus, tracked by `payments` rows rather than
  solved in code. Settlement reporting is Phase 7.
- Online payment introduces a window where the order exists but payment is unconfirmed.
  Handled by holding the order at `pending` until payment is `success`, with a timeout that
  cancels unpaid orders — so a canteen never cooks food that was never paid for.
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
