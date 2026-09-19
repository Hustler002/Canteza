# CampusEats — Architecture

> Your Campus. Your Food. Delivered.

Status: **living document**. Last updated 2026-09-19 (Phase 1).

---

## 1. Product architecture

One college. Multiple campus canteens. Students in hostels order food and a delivery
partner walks it to their room. Four roles, three surfaces:

| Role             | Surface       | Why                                                          |
| ---------------- | ------------- | ------------------------------------------------------------ |
| Student          | Mobile app    | Ordering happens on a phone, in bed, at 1am                  |
| Canteen          | Mobile app    | Counter staff have a phone, not a POS terminal               |
| Delivery partner | Mobile app    | Used while walking                                           |
| Admin            | Web dashboard | Tables, filters, charts — needs a keyboard and a wide screen |

```
              ┌──────────────────────────────────────────┐
              │      Expo app  (one codebase, 3 roles)   │
              │   Student  │  Canteen  │  Delivery       │
              └──────────────────┬───────────────────────┘
                                 │ supabase-js
                                 │ (JWT, RLS-scoped)
   ┌──────────────┐              ▼
   │ Next.js      │   ┌────────────────────────────────────┐
   │ Admin (web)  │──▶│            Supabase                │
   └──────────────┘   │  Auth  │ Postgres+RLS │ Realtime   │
                      │  Storage │ Edge Functions          │
                      └───────────────┬────────────────────┘
                                      │
                                Razorpay (webhook)
```

There is no custom API server. Postgres _is_ the application core: RLS for authorization,
`SECURITY DEFINER` functions for state transitions, Realtime for live updates. Edge
Functions exist only where a secret or a third party is involved (payment verification,
push fan-out).

## 2. Repository layout

npm workspaces monorepo. One repo, one `npm install`, one place to change a shared rule.

```
packages/shared/     Domain core: money, order state machine, pricing, rules, errors
apps/mobile/         Expo + expo-router. Student / Canteen / Delivery
apps/admin/          Next.js App Router
supabase/migrations/ Schema, RLS policies, RPC functions  (authoritative)
supabase/functions/  Edge Functions (payments, push)
docs/                This file + ADRs
```

`packages/shared` is consumed as TypeScript source — no build step, no stale `dist`.

## 3. Data flow

**Reads** go straight from client to Postgres via PostgREST, filtered by RLS. A student's
`select * from orders` physically cannot return another student's rows.

**Writes that carry business rules** go through Postgres RPC functions (`place_order`,
`transition_order`, `claim_delivery`). Clients have no `UPDATE` grant on `orders.status`.

**Writes that need a secret** go through an Edge Function (`verify-payment`).

**Live updates** arrive over Supabase Realtime. The same RLS policy governs the stream, so
a subscription cannot leak what a query could not.

```
Student taps "Place order"
   │  rpc('place_order', { canteen_id, items, address, idempotency_key })
   ▼
Postgres transaction
   ├── re-reads prices from menu_items      (client-sent prices are ignored)
   ├── validates canteen open + items available
   ├── computes totals
   ├── inserts order + order_items + payment + order_status_history
   └── inserts notifications for student & canteen
   │
   ▼  Realtime broadcast (RLS-scoped)
Canteen device shows the order within ~1s
```

## 4. Authentication flow

Supabase Auth, email + password for MVP (phone OTP is a config change, not a rewrite).

1. User signs up → row in `auth.users`.
2. A trigger creates `public.profiles` with `role = 'student'` by default.
3. Canteen staff and delivery partners are **not** self-serve: an admin creates them, and
   role elevation only ever happens server-side.
4. RLS reads the role through `public.auth_role()`, a `stable security definer` helper
   that looks it up from `profiles`. Being security-definer is what stops the lookup
   recursing into the policy being evaluated, and `stable` lets Postgres cache it per
   statement. (Phase 2 chose this over a custom JWT claim: a claim needs an auth hook
   configured outside the migrations, and goes stale until the token refreshes — so a
   demoted user would keep their old role for up to an hour. If profile lookups ever
   show up in a query plan, swapping in a claim is a change to one function.)
5. Session persists in secure storage on mobile (`expo-secure-store`) and an httpOnly
   cookie in the admin app; supabase-js refreshes silently.

**The client never asserts its own role.** It reads its own profile row to pick which
navigation tree to mount; the database independently enforces the same role, and
`profiles.role` has no UPDATE grant so no client can rewrite it.

## 5. Authorization model

Three layers, each independently sufficient for its own scope:

| Layer             | Enforces                                           |
| ----------------- | -------------------------------------------------- |
| RLS policies      | Row visibility and ownership — the real boundary   |
| RPC functions     | Which transitions an actor may perform, atomically |
| Client navigation | Ergonomics only. Assume it is bypassed.            |

| Actor    | Can read                                         | Can write                                   |
| -------- | ------------------------------------------------ | ------------------------------------------- |
| Student  | own profile, own orders, all open canteens/menus | own profile, own orders via `place_order`   |
| Canteen  | own canteen, own menu, orders for own canteen    | own menu; own orders via `transition_order` |
| Delivery | orders in `ready` (pool) + own assigned orders   | own assignments via `claim_delivery`        |
| Admin    | everything                                       | everything, audited                         |

A delivery partner sees the student's hostel/block/room **only for an order they hold**.
Unclaimed work is offered through `public.delivery_pool`, a view that projects canteen,
hostel and payout — and deliberately omits `room` and `student_id`. Deciding whether to
take a job does not require knowing whose door it is.

Privileges are role-wide and a policy cannot restrict columns, so anything that must never
be client-writable is withheld at the `GRANT`, not at the policy:

| Column                          | Why there is no grant                     |
| ------------------------------- | ----------------------------------------- |
| `profiles.role`                 | Self-promotion to admin                   |
| `delivery_partners.is_approved` | Self-approval                             |
| everything on `orders`          | All movement belongs to the RPC functions |

Both exceptions are reachable only through audited `security definer` functions
(`admin_set_role`, `admin_set_partner_approval`) that check `is_admin()` first.

## 6. Order lifecycle

Canonical definition: [`packages/shared/src/order-status.ts`](../packages/shared/src/order-status.ts),
mirrored by the `transition_order` SQL function.

```
              ┌──────────── student / admin cancel
              ▼
 pending ──accept(canteen)──▶ accepted ──▶ preparing ──▶ ready
    │                                                     │
    └──reject(canteen)──▶ rejected           claim(delivery)
                                                          ▼
                                     ready ◀──release── assigned
                                                          │
                                                    pickup(delivery)
                                                          ▼
                                                      picked_up
                                                          │
                                                   deliver(delivery)
                                                          ▼
                                                      delivered
```

Decisions baked in:

- **`out_for_delivery` was removed.** On a walkable campus it is the same physical moment
  as pickup. One tap, not two. Students see `picked_up` as "On the way".
- **Assignment is a pull, not a push.** `ready` orders are a pool; the first partner to
  claim wins. No dispatcher, no assignment algorithm, no orphaned pushes.
- **Students cancel only while `pending`.** Once a canteen accepts, the kitchen has
  committed. Later cancellation is an admin action with a refund.
- **Every transition writes `order_status_history`** (from, to, actor, timestamp). Support
  questions are answered from data, not guesswork.

### Race conditions and how each is prevented

| Scenario                                    | Mechanism                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| Student taps "Place order" twice            | `idempotency_key` UNIQUE on `orders`; second call returns the first order      |
| Two partners claim the same delivery        | `UPDATE … WHERE status='ready' AND delivery_partner_id IS NULL`; 0 rows ⇒ lost |
| Two canteen staff act on one order          | Every transition is `UPDATE … WHERE status = <expected>`                       |
| Item sells out during checkout              | Availability is re-checked inside the `place_order` transaction                |
| Student cancels as canteen accepts          | Both are conditional updates on `status='pending'`; one wins                   |
| Payment succeeds, app disconnects           | Razorpay webhook is the source of truth, not the client callback               |
| Price changes between browsing and checkout | Server re-reads prices; `order_items` snapshots what was charged               |

## 7. Payment lifecycle

```
initiated ──▶ pending ──▶ success ──▶ refunded
     │            │
     └──────▶ failed ──▶ initiated (retry)
```

MVP default is **cash on delivery**, which is what campus actually runs on. It starts at
`pending` and is settled by the partner at the door.

Razorpay is the second method and is already modelled: the client gets an order token, the
user pays, and `payments.status` moves to `success` **only** when the `verify-payment`
Edge Function validates the HMAC signature of Razorpay's webhook. A client saying "payment
succeeded" changes nothing in the database.

Payment status is deliberately independent of order status: an order can be `delivered`
with payment `pending` (COD), and `refunded` long after delivery.

## 8. Notification lifecycle

The RPC that changes order state also inserts the notification rows, in the same
transaction. There is no separate worker to fall out of sync, and a rolled-back transition
cannot leave a phantom notification behind.

```
transition_order()  ──┬──▶ orders.status
                      ├──▶ order_status_history
                      └──▶ notifications (student / canteen / delivery)
                                   │
                        Realtime ──┴──▶ in-app badge + list
                                   └──▶ (Phase 6) DB webhook → Edge Function → Expo Push
```

A `notifications` row stores **no text** — only `(user_id, audience, order_id, status)`.
The wording is rendered from that pair by
[`packages/shared/src/notifications.ts`](../packages/shared/src/notifications.ts), so the
in-app text and the future push text cannot drift, and fixing a typo does not require
rewriting history.

Partners are notified only about an order they already hold; unclaimed work is discovered
by querying `delivery_pool`, so a ready order does not fan out a row per online partner.

## 9. Real-time architecture

Supabase Realtime over Postgres logical replication.

| Surface  | Subscription                                        |
| -------- | --------------------------------------------------- |
| Student  | `orders` where `student_id = me` (active order)     |
| Canteen  | `orders` where `canteen_id = mine`                  |
| Delivery | `orders` where `status = 'ready'` OR assigned to me |
| Admin    | aggregate counters, refreshed on a timer            |

Realtime events invalidate the matching TanStack Query cache key rather than patching
state by hand — one code path for fresh data, whether it arrived by push or by refetch.
If a socket drops, the normal refetch-on-focus still renders the truth.

## 10. Deployment architecture

| Component | Target                         | Notes                             |
| --------- | ------------------------------ | --------------------------------- |
| Database  | Supabase (Mumbai region)       | Migrations via Supabase CLI in CI |
| Mobile    | EAS Build → APK / TestFlight   | OTA updates for JS-only changes   |
| Admin     | Vercel                         | Preview deploy per PR             |
| Functions | Supabase Edge Functions (Deno) | Deployed with the migrations      |
| Errors    | Sentry (both apps)             | Behind a thin wrapper, swappable  |

One campus does not need staging infrastructure beyond a second Supabase project.

## 11. Major technical choices

Each has an ADR in [`docs/decisions/`](./decisions/):

| #   | Decision                                                       |
| --- | -------------------------------------------------------------- |
| 1   | Expo (React Native) for one mobile codebase, three roles       |
| 2   | Supabase as the backend; Postgres functions for business logic |
| 3   | Postgres, money as integer paise, snapshots for history        |
| 4   | TanStack Query for server state, Zustand for the cart          |
| 5   | Order state machine: transition table, pull-based assignment   |
| 6   | Payments: COD first, Razorpay behind a verified-webhook seam   |
| 7   | Database tests run on in-process Postgres (PGlite), no Docker  |

## 12. What we deliberately are not building

Microservices, Kubernetes, an event bus, GraphQL, a custom API gateway, route
optimisation, multi-college tenancy, a wallet. The schema does not block any of them —
`orders` will carry `campus_id`, and `delivery_batch_id` is a nullable FK — but none is
built until one campus works reliably.

`campus_id` and `delivery_batch_id` were named in earlier drafts as columns to add now.
They are not in the Phase 2 schema: a column with one possible value buys nothing, and
adding either later is a one-line `alter table`. Nothing in the schema blocks them.
