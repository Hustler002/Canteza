# ADR 005 — Order state machine: explicit transition table, pull-based assignment

Status: **accepted**, partially superseded · 2026-09-19

> **Superseded in part by [ADR 008](./008-canteen-scoped-delivery.md).** The transition
> table and the removal of `out_for_delivery` still stand. The _global_ pull model below
> does not: delivery partners belong to a single canteen and claim only from that
> canteen's queue. ADR 008 explains why and what changed.

## Decision

Nine order statuses with an explicit `(from, to) → allowed actors` table, declared once in
[`packages/shared/src/order-status.ts`](../../packages/shared/src/order-status.ts) and
enforced authoritatively by the `transition_order` Postgres function.

```
pending → accepted → preparing → ready → assigned → picked_up → delivered
   ↓ rejected                              ↑___release___|
   ↓ cancelled
```

Two changes from the shape sketched in the product brief:

1. **`out_for_delivery` is removed.** It is merged into `picked_up`.
2. **Assignment is a pull, not a push.** `assigned` is reached by a partner claiming from
   an open pool, not by a dispatcher pushing and a partner then accepting.

## Context

This is the spine of the product. Four actors mutate one row from four devices, often at
the same second. Getting it wrong means food that is cooked twice, delivered twice, or
never.

## Alternatives considered

**On status modelling:**

1. **Keep `out_for_delivery` as a distinct state.** Matches food-delivery apps that cross a
   city. On a campus, pickup and departure are the same instant — the partner is holding
   the bag and walking. It would be a second tap that always follows the first, and a
   status that is never observed for more than a few seconds. Rejected as ceremony.
2. **A boolean/timestamp column set (`accepted_at`, `ready_at`, …) with no status enum.**
   Self-documenting timestamps, but "what state is this order in" becomes a derived
   expression every reader must re-implement. Rejected. (We keep the timestamps _as well_,
   in `order_status_history`, where they answer "how long did the kitchen take".)

**On assignment:**

3. **System assigns a partner, partner accepts or declines.** Better for fairness and
   guaranteed coverage at scale, but it needs an assignment algorithm, an acceptance
   timeout, a reassignment path, and a way to handle a partner who has gone offline with a
   pushed order. Rejected for the MVP: five partners on one campus who can all see the
   pool self-organise fine, and the schema does not prevent adding dispatch later.

## Why an explicit transition table

- **Impossible transitions cannot be expressed.** `delivered → preparing` is not a bug to
  catch; it is absent from the table.
- **Authorization is part of the transition, not a separate check.** The table says who may
  perform each edge, so "a student cannot mark their own order delivered" is structural.
- **The UI is generated from it.** `nextStatusesFor(status, actor)` decides which buttons a
  screen renders, so screens and rules cannot disagree.
- **It is testable without a database.** The machine is pure TypeScript with 12 tests,
  including a reachability check that every non-terminal state can still reach a terminal
  one — so an added state can never strand an order.

## Race-condition handling

Every transition is a conditional update, so concurrency is decided by Postgres:

```sql
update orders set status = $new
 where id = $1 and status = $expected     -- 0 rows ⇒ someone else moved it
```

The delivery claim adds the assignment guard, which is what makes two partners tapping
"Accept" at the same moment safe:

```sql
update orders set status = 'assigned', delivery_partner_id = $partner
 where id = $1 and status = 'ready' and delivery_partner_id is null
```

Zero rows updated is not an error state to paper over — it raises
`DELIVERY_ALREADY_CLAIMED`, which the app shows as "Another partner picked up this
delivery first" and refreshes the pool.

## Trade-offs

- The table is duplicated in TypeScript and SQL. Divergence is the risk; it is mitigated by
  both being small, declarative, and covered by tests that run against a real database in
  CI. A generator was considered and rejected as more machinery than the thing it generates.
- Merging `out_for_delivery` means that if the product ever expands beyond a walkable
  campus, a state must be added back. That is a one-line migration plus a label.

## Consequences

- Clients have no `UPDATE` privilege on `orders`. All movement goes through
  `transition_order` / `claim_delivery`.
- Every transition writes `order_status_history` and the relevant `notifications` rows in
  the same transaction.
- Adding a status means editing one table in TypeScript, one in SQL, and one label map —
  and the reachability test fails loudly if the new state is a dead end.
