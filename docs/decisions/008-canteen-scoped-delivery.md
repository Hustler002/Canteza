# ADR 008 — Delivery is canteen-scoped, not a campus-wide pool

Status: **accepted** · 2026-09-19 · **supersedes the pull-from-global-pool part of [ADR 005](./005-order-state-machine.md)**

## Decision

A delivery partner belongs to exactly one canteen and may only carry that canteen's
orders. The campus-wide delivery pool built in Phase 2 is removed.

Assignment stays a **pull**, but scoped: a canteen's own partners see that canteen's
ready queue and claim from it. When no partner is on shift, **the canteen can deliver the
order itself** (`ready → delivered` by `canteen`).

The rule `delivery_partner.canteen_id = order.canteen_id` is enforced by a composite
foreign key — not by a trigger, and not by application code.

## Context

ADR 005 assumed a gig-economy shape: any approved partner could claim any ready order,
like a city-wide courier network. That was wrong about this business.

**External delivery workers cannot enter the campus.** Each canteen therefore employs its
own delivery staff, who are that canteen's people. Canteen A's partner has no business
carrying Canteen B's food, no relationship with Canteen B, and no reason to see its orders.

Partners are also not paid by us — the canteen pays them — which changes the money model
as well as the access model.

## Alternatives considered

**On assignment within a canteen:**

1. **Self-claim from the canteen's queue (chosen).** The partner opens the app, sees their
   canteen's ready orders, taps one. The atomic claim already existed and only needed
   scoping, so this was the smallest change, and it adds no work to a counter that is busy
   at exactly the moment an order goes ready. With one or two partners per canteen there is
   very little to contend over.
2. **Canteen explicitly assigns to a named partner.** More managerial control and a
   clearer audit trail. Rejected for the MVP: it needs a partner-picker in the canteen app
   and inserts a decision into the rush. Nothing in the schema prevents adding it — the
   `ready → assigned` edge already permits `admin`, and permitting `canteen` plus a target
   partner is additive.
3. **Both from the start.** Two flows to build, test and explain before we know which one
   canteens actually use.

**On enforcing the canteen match:**

4. **Check it in `claim_delivery` only.** One line, and wrong: it holds exactly as long as
   nobody writes a second code path. Admin tooling, a future assignment flow or a repair
   script would each need to remember.
5. **A `BEFORE UPDATE` trigger.** Genuinely enforced, but it is code that can have a bug,
   and it runs on every order update for a rule that applies to one column pair.
6. **A composite foreign key (chosen).**

```sql
alter table public.orders
  add constraint order_partner_belongs_to_canteen
  foreign key (delivery_partner_id, canteen_id)
  references public.delivery_partners (profile_id, canteen_id);
```

`delivery_partner_id` is nullable and Postgres foreign keys default to `MATCH SIMPLE`, so
an unassigned order skips the check entirely. The moment a partner is attached, the
`(partner, canteen)` pair must exist in `delivery_partners`. A cross-canteen assignment is
not rejected by our code — it is **unrepresentable**. A test proves it by attempting the
write as the table owner, with RLS and every function bypassed, and watching Postgres
refuse.

## Why the primary key is `(profile_id, canteen_id)`

The obvious schema is `profile_id` as the primary key with a `canteen_id` column. It
breaks the first time someone changes jobs: old orders reference `(person, old canteen)`,
so the foreign key blocks ever updating that person's canteen, forever.

So a partner record is a **posting**, not a person:

- primary key `(profile_id, canteen_id)` — the composite foreign key's target
- `unique (profile_id) where is_active` — one active posting per person at any moment
- transferring someone deactivates the old posting and adds a new one

Historical orders keep resolving to the canteen the person actually delivered for, which
is the truth an order should record. `admin_set_partner_canteen()` performs the swap in
one transaction.

## Revenue model

Partners are paid by their canteen, so `orders.partner_payout_paise` was the wrong fact to
record. It is replaced by `orders.platform_fee_paise`.

| Party    | Receives                                                   |
| -------- | ---------------------------------------------------------- |
| Canteen  | 100% of the food subtotal, plus ₹8 of the ₹10 delivery fee |
| Platform | ₹2 of the delivery fee. Nothing on food.                   |
| Partner  | Paid by their canteen out of the canteen's share           |

We take **nothing on food** on purpose. The near-term goal is that canteens make money and
adopt the platform; ours is to cover running costs and a little more. At roughly 100 orders
a day, ₹2 per order is about ₹6,000/month against a Supabase Pro bill near ₹2,100, with
Expo and Vercel on free tiers. It also gives canteen managers a sentence they can agree to
in one breath: _every rupee of the food is yours; we take ₹2 of the delivery charge to keep
the app running._

`platform_fee_paise` lives in `platform_settings`, so the split changes without a
migration, and it is snapshotted on the order so changing it never rewrites past
settlements. A `CHECK` keeps it at or below the delivery fee it is taken from.

## What changed in Phase 2

| Before                                           | After                                                           |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `delivery_partners (profile_id, …)`              | `+ canteen_id, is_active`; PK `(profile_id, canteen_id)`        |
| `delivery_pool` view (campus-wide, hid the room) | **deleted** — the orders policy scopes the queue on its own     |
| `is_delivery_partner()` → boolean                | `my_delivery_canteen_id()` → uuid; the boolean wraps it         |
| `claim_delivery` checked approval only           | also checks the canteen; distinguishes "not yours" from "taken" |
| `orders_read`: own assigned orders               | `+ own canteen's unclaimed ready queue`                         |
| `orders_ready_pool (created_at)`                 | `orders_ready_by_canteen (canteen_id, created_at)`              |
| `admin_set_partner_approval(profile, approved)`  | `admin_set_partner_canteen(profile, canteen, approved)`         |
| —                                                | `canteen_set_partner_active(profile, active)`                   |
| `orders.partner_payout_paise`                    | `orders.platform_fee_paise`                                     |
| —                                                | `ready → delivered` by `canteen` (no partner on shift)          |

## Trade-offs

- **A canteen with no partner on shift can stall.** Mitigated by letting the counter
  deliver it themselves; nothing routes an order to a neighbouring canteen's staff, which
  is correct — that person cannot be asked to carry another business's food.
- **No load balancing across canteens.** Deliberate. It is not a pool, it is five separate
  small teams.
- **Partners now see the room number on unclaimed orders of their own canteen.** The old
  view hid it because a stranger might see it. A canteen's own employee is not a stranger,
  and room-level delivery is the product — they need the destination to decide and to walk.
- **A transfer leaves a dead posting row behind.** That is the price of historical
  integrity, and it is queryable as employment history rather than being noise.

## Open question, deferred

Who funds a coupon discount? Today it reduces the food subtotal, so the **canteen** absorbs
it even if an admin created the code. That is fine while coupons are unused, but before
Phase 7 ships them, decide whether platform-issued discounts should come out of the
platform's share instead.
