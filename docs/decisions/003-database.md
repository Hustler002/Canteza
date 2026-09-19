# ADR 003 — Postgres, integer paise, and snapshotting for historical integrity

Status: **accepted** · 2026-09-19

## Decision

Relational Postgres. Three schema rules are non-negotiable:

1. **All money is `integer` paise.** Never `float`, never `numeric` rupees.
2. **Orders snapshot what was charged.** `order_items` stores the item name and unit price
   as of purchase; `orders` stores the delivery address as text alongside the hostel FK.
3. **Nothing operational is hard-deleted.** Canteens, menu items and users are disabled via
   flags so historical orders stay readable.

## Context

Orders, order items, payments, assignments, menus and hostels are a textbook relational
model with strong foreign-key relationships and reporting needs. An order is also a
financial record: what it says today must still be true in a year.

## Alternatives considered

1. **Document store (Firestore/Mongo) with embedded order documents.** Snapshotting comes
   free, but revenue reporting, "orders per canteen per hour", and referential integrity
   between deliveries and partners all become application code. Rejected.
2. **Postgres with `numeric(10,2)` for money.** Exact, and avoids the mental overhead of
   paise. Rejected because the value crosses into JavaScript, where `numeric` arrives as a
   string or lossily as a float; integer paise survives the trip to the client and back
   with no representation question at any boundary.
3. **Normalised orders that join to `menu_items` for price.** Smaller, but wrong: raising
   Cold Coffee from ₹50 to ₹60 would silently rewrite every past receipt.

## Why snapshots

The brief's example is the whole argument. An order is an immutable record of a
transaction, not a view over current data. So:

| Column                                 | Why it is a snapshot                 |
| -------------------------------------- | ------------------------------------ |
| `order_items.name_snapshot`            | The item may be renamed or removed   |
| `order_items.unit_price_paise`         | The price will change                |
| `orders.delivery_fee_paise`            | Platform fees change                 |
| `orders.hostel_label`, `block`, `room` | Students change rooms between terms  |
| `orders.canteen_name_snapshot`         | A canteen may be disabled or renamed |

The FK is kept _as well_ (`order_items.menu_item_id`) so "reorder" and analytics can still
join to live data. Snapshot for display, FK for aggregation.

## Trade-offs

- Mild denormalisation and some storage duplication. At campus volume (hundreds of orders
  a day) this is irrelevant, and it removes an entire class of correctness bug.
- Integer paise means every display path must go through `formatPaise()`. Enforced by
  keeping money formatting in exactly one module.
- Soft deletes mean every query must filter on the active flag. Handled with RLS policies
  and views rather than trusting each query to remember.

## Consequences

- `packages/shared/src/money.ts` is the only place money is formatted or converted, and it
  throws on non-integer paise so a bad value fails loudly at the boundary.
- Schema conventions: `uuid` primary keys (`gen_random_uuid()`), `created_at`/`updated_at`
  on every table, `text` + `CHECK` constraints for status columns rather than Postgres
  enums (adding a value to an enum inside a transaction is awkward; a `CHECK` is a one-line
  migration).
- `order_status_history` is append-only and is the audit trail for every dispute.
- Indexes are added with the query that needs them, in the same migration — most
  importantly `orders (canteen_id, status)`, `orders (student_id, created_at desc)` and a
  partial index on `orders (status) WHERE status = 'ready'` for the delivery pool.
