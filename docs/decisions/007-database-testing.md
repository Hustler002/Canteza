# ADR 007 — Database tests run on in-process Postgres (PGlite)

Status: **accepted** · 2026-09-19

## Decision

`supabase/test/` applies the real migrations to [PGlite](https://pglite.dev) — Postgres
compiled to WebAssembly, running inside the Vitest process — and exercises RLS, the order
state machine and the money maths against it. A small shim supplies the parts of Supabase's
`auth` schema the migrations touch (`auth.users`, `auth.uid()`, the `authenticated` role).

## Context

Almost all of Phase 2 is SQL: policies, constraints, and four `plpgsql` functions holding
the business rules. The exit criteria are security claims — "a student cannot read another
student's order", "two partners cannot both claim one delivery" — and a security claim that
has never been executed is a guess.

The usual way to run it is `supabase start`, which needs Docker. **This machine has no
Docker and no `psql`.**

## Alternatives considered

1. **Ship the SQL unexecuted, verify later on someone's machine with Docker.** Fastest to
   write and the worst option available: ~700 lines of unrun SQL carrying the entire
   authorization model. The first `place_order` typo would surface in Phase 4, tangled up
   with whatever else was being built that day.
2. **Require Docker and `supabase start`.** The orthodox answer, and it tests the real
   thing — Realtime, GoTrue, PostgREST included. Rejected as the _only_ mechanism because
   it cannot run here at all, and a test suite that cannot run is not a test suite. It
   remains the right tool for what PGlite cannot do.
3. **Mock the database / test business rules only in TypeScript.** The TypeScript copy of
   the rules is already tested. Mocking Postgres would test the mock: RLS, `FOR SHARE`,
   conditional `UPDATE`s and unique constraints are precisely the behaviours a mock invents.

## Why PGlite

- It is **real Postgres**, not an emulation — same planner, same RLS engine, same
  `plpgsql`, same constraint and locking semantics.
- It runs the **actual migration files**, in timestamp order, so a migration that does not
  apply fails a test rather than a deploy.
- No Docker, no daemon, no ports, ~2s for the whole suite, and it works in CI unchanged.

It caught real defects immediately: `pgcrypto` is unavailable (and was never needed —
`gen_random_uuid()` has been core since Postgres 13), and it forced the temp table out of
`place_order` before plpgsql plan caching could turn it into an intermittent production
bug.

## Trade-offs

- **It cannot run two transactions at once.** PGlite is single-connection, so the race
  tests drive the sequence rather than the parallelism: partner A claims, partner B is
  refused. That verifies the guard exists and that the loser gets
  `DELIVERY_ALREADY_CLAIMED` — the atomicity itself is Postgres's, and proving it under
  genuine parallelism needs a real server. This is the one gap, and it is written down in
  `supabase/test/README.md` rather than left implied.
- **Supabase's own services are out of scope**: Auth, Realtime, Storage, PostgREST. JWT
  claims are set directly instead of being verified. `supabase/seed-users.mjs` covers the
  rest by driving the real RPCs over HTTP against a running Supabase.
- PGlite tracks a recent Postgres (18) while Supabase runs 15/17, so the SQL sticks to
  features common to both. No version-specific syntax is used.

## Consequences

- `npm test` runs the database tests with no setup, on any machine.
- Two checks in `schema.test.ts` are structural and will catch future mistakes on their
  own: every table in `public` must have RLS enabled, and every table must have at least
  one policy. A new table without either fails CI.
- `order_transitions` is a **table**, not a `CASE` statement, specifically so a test can
  diff it against `ORDER_TRANSITIONS` in `packages/shared`. Drift between the TypeScript
  state machine and the SQL one fails immediately.
- When Docker becomes available, the parallel-claim scenario should be added against
  `supabase start`. Nothing needs restructuring for that — the same scenarios, two
  connections.
