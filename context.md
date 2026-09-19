# CampusEats — full project context

Background for anyone (human or model) picking this up cold. For _where the work currently
stands_, read [`CLAUDE.md`](./CLAUDE.md). For _why_ a technical choice was made, read the
ADR in [`docs/decisions/`](./docs/decisions/).

---

## 1. What we are building

**CampusEats — Your Campus. Your Food. Delivered.**

A campus-only food delivery platform. Students in college hostels order from campus
canteens; a delivery partner carries the food to their hostel room. Everything happens
inside one campus, on foot, over short distances.

This is a real startup MVP for one college, not a demo or a CRUD exercise. It is expected
to handle real money, real orders, and real concurrent users on day one.

## 2. Who uses it

| Role                 | Device        | What they do                                                       |
| -------------------- | ------------- | ------------------------------------------------------------------ |
| **Student**          | Mobile app    | Browse canteens, search, cart, checkout, track, rate, reorder      |
| **Canteen staff**    | Mobile app    | Receive orders, accept/reject, prepare, mark ready, manage menu    |
| **Delivery partner** | Mobile app    | See their canteen's ready queue, claim, pick up, deliver, earnings |
| **Admin**            | Web dashboard | Manage users/canteens/hostels/food, monitor orders and revenue     |

Canteen staff may not be technical. Their screens are large-button, low-navigation, and
loud about new orders. Delivery partners use the app one-handed while walking.

## 3. The core flow

Everything else is secondary to this path working reliably:

```
student browses → adds to cart → checkout (hostel + block + room) → places order
   → canteen receives it live → accepts → prepares → marks ready
   → that canteen's own partner claims it → picks up → delivers
   → student sees "Delivered" → rates / reorders
```

## 4. The stack

| Layer    | Choice                                        | ADR |
| -------- | --------------------------------------------- | --- |
| Mobile   | Expo / React Native / `expo-router` (one app) | 001 |
| Admin    | Next.js App Router                            | —   |
| Backend  | Supabase — no custom API server               | 002 |
| Database | Postgres with RLS                             | 003 |
| Logic    | Postgres `SECURITY DEFINER` functions         | 002 |
| Realtime | Supabase Realtime (RLS-scoped)                | 002 |
| State    | TanStack Query + Zustand                      | 004 |
| Payments | COD now, Razorpay behind webhook verification | 006 |
| Repo     | npm workspaces monorepo                       | —   |

Full picture with diagrams: [`docs/architecture.md`](./docs/architecture.md).

## 5. The ideas that shape the code

These are the non-obvious commitments. Violating one of them is how this codebase breaks.

### Postgres is the application core

There is no API server. Authorization is RLS, so "a student cannot read another student's
order" is a database policy rather than a rule an endpoint might forget. Business rules
that must be atomic live in Postgres functions, because order placement does six things
that cannot be allowed to interleave.

### The client is never trusted

Not for prices, not for role, not for payment status, not for order ownership, not for
totals. `place_order` receives item ids and quantities and re-reads everything else from
the database. A client claiming "payment succeeded" changes nothing; only a verified
Razorpay webhook does.

### Money is integer paise

`0.1 + 0.2 !== 0.3`, and order totals must reconcile exactly. Every amount in the system
is an integer number of paise, formatted only by `formatPaise()`, which throws on a
non-integer so bad values fail at the boundary instead of silently in a receipt.

### Orders are immutable financial records

An order says what was actually charged. Item names and unit prices are snapshotted into
`order_items` at purchase; raising a price tomorrow must not rewrite yesterday's receipt.
The foreign key is kept as well, so reorder and analytics can still join to live data —
snapshot for display, FK for aggregation. Nothing operational is hard-deleted; canteens,
items and users are disabled with flags so old orders stay readable.

### Concurrency is decided by the database

Four actors mutate one order row from four devices. Every transition is a conditional
update (`WHERE status = <expected>`); zero rows updated means someone else got there
first, and that is surfaced to the user rather than retried. Order creation is idempotent
on a client-supplied key, so a double-tap produces one order.

### The state machine is declared once

Nine statuses and an explicit `(from, to) → allowed actors` table. Impossible transitions
are not validated against — they are unrepresentable. The same table decides which buttons
a screen renders, so UI and rules cannot disagree.

It exists twice — in TypeScript and as the `order_transitions` **table** in Postgres — and
a test diffs one against the other, so the copies cannot drift apart silently.

### Security is withheld, not just filtered

Postgres privileges are role-wide and an RLS policy cannot restrict columns. So anything
that must never be client-writable has no `GRANT` at all: `profiles.role`,
`delivery_partners.is_approved`, and every write on `orders`. Those paths exist only as
audited `security definer` functions. A forgotten policy is then a visibility bug, never a
privilege-escalation one.

## 6. Deliberate departures from the original brief

Both are argued in [ADR 005](./docs/decisions/005-order-state-machine.md).

1. **`out_for_delivery` was removed**, merged into `picked_up`. On a walkable campus, the
   partner picking up the bag and departing is one moment. A second tap that always
   immediately follows the first is ceremony. Students still see "On the way".
2. **Delivery assignment is a pull, not a push — and it is canteen-scoped.** External
   couriers cannot enter campus, so every canteen employs its own delivery staff. A
   partner belongs to one canteen and claims from that canteen's ready queue; there is no
   campus-wide pool. When nobody is on shift the counter delivers it themselves. See
   [ADR 008](./docs/decisions/008-canteen-scoped-delivery.md), which supersedes the
   global-pool part of ADR 005.

## 7. What is deliberately not being built

Microservices, Kubernetes, event buses, GraphQL, a custom API gateway, route optimisation,
multi-college tenancy, wallets, loyalty, subscriptions, AI recommendations.

The architecture does not block any of them. Earlier drafts promised `orders.campus_id`
and `orders.delivery_batch_id` up front; Phase 2 left both out, because a column with one
possible value buys nothing and adding either is a one-line `alter table` on the day
batching or a second campus actually arrives.

## 8. Quality bar

- TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- `npm run verify` (format, lint, typecheck, test) must pass before work is called done.
- Critical logic carries tests: state transitions, pricing, cart rules, payment states.
- Vertical slices. One working end-to-end path beats twenty half-built screens.
- No fake screens that are disconnected from the backend to make progress look impressive.

## 9. Launch assumptions

One college. Several canteens. Students live in hostels. Delivery is on foot, inside
campus. Delivery is charged separately: ₹10, of which ₹8 goes to the canteen (who pays
their own delivery staff) and ₹2 is our entire revenue — we take nothing on food, because
canteens need to profit first. Canteens manage their own menus and their own delivery
staff. Hundreds of orders a day, not millions. Optimise for reliability on one
campus, not for scale that does not exist yet.
