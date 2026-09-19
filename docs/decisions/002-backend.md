# ADR 002 — Supabase as the backend; Postgres functions hold the business logic

Status: **accepted** · 2026-09-19

## Decision

Supabase (managed Postgres + Auth + Realtime + Storage + Edge Functions) is the backend.
There is no custom API server.

Reads go client → PostgREST, constrained by RLS. Mutations that carry business rules go
through `SECURITY DEFINER` Postgres functions. Anything needing a secret or a third party
goes through an Edge Function.

## Context

The platform needs auth, a relational database, row-level authorization, realtime order
updates, file storage for food images, and a place to verify payment webhooks. A one-campus
MVP must be operable by one person and cost near zero at low volume.

## Alternatives considered

1. **Custom Node/Fastify API + managed Postgres + Prisma.** Maximum control and a familiar
   shape. But it means hand-writing auth, sessions, refresh tokens, a websocket layer, a
   storage service, plus hosting, deploys, monitoring and scaling for all of it. Weeks of
   work reproducing what Supabase ships, with more to operate at 3am.
2. **Firebase.** Superb realtime and auth, but Firestore is the wrong shape here: orders,
   order items, payments, assignments and menus are deeply relational, and reporting
   ("revenue by canteen this week") is painful without SQL. Rejected on the data model.
3. **Supabase for auth/data, plus a thin Node service for business logic.** A reasonable
   middle ground, and the obvious escape hatch later. Rejected for now because it adds a
   deployable component whose only job would be work Postgres can do transactionally.

## Why Supabase

- **RLS is exactly the authorization model the product needs.** "A student cannot read
  another student's order" becomes a database policy, not a rule a forgotten endpoint can
  skip. Section 10 of the product brief is satisfied at the storage layer.
- **Realtime is RLS-aware.** The live order feed inherits the same policy as the query —
  a subscription cannot leak what a `select` could not.
- Auth, storage, and a Deno function runtime arrive with it, already wired to the same JWT.
- Postgres transactions make the hard parts (idempotent order creation, atomic delivery
  claim) a single statement rather than a distributed-systems problem.

## Why business logic lives in Postgres functions

Order placement must do six things atomically: validate the canteen is open, re-read prices
from the database, validate item availability, compute totals, insert the order and its
items, and insert notifications. Split across client calls, any of those is a race window.
As one `plpgsql` function it is one transaction, and the client never gets an `UPDATE`
grant on `orders.status` at all.

## Trade-offs

- **Business rules live in SQL**, which is less pleasant to test and refactor than
  TypeScript. Mitigated by keeping the functions small and imperative, and by testing them
  against a local Supabase instance in CI.
- **Rules are stated twice** — in `packages/shared` for pre-submit UX, and in SQL as the
  authority. This is deliberate duplication, documented at the top of `rules.ts`. The SQL
  copy always wins; the TypeScript copy only ever decides whether a button is disabled.
- **Vendor coupling.** Real, but bounded: the data is plain Postgres and the migrations are
  plain SQL. Leaving Supabase means replacing Auth, Realtime and Storage — not the schema.

## Consequences

- `supabase/migrations/` is the authoritative source for schema, policies and functions.
- Every new table gets an RLS policy in the same migration that creates it. A table without
  a policy is a bug, and CI checks for `rowsecurity = false` in `public`.
- The service-role key is used only in Edge Functions and CI. It never reaches a client.
