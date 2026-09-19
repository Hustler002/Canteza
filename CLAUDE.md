# CampusEats — project state

**Read this first in a new session.** Product and architectural background is in
[`context.md`](./context.md); the reasoning behind each choice is in
[`docs/decisions/`](./docs/decisions/).

---

## Where the project is right now

**Phase 2 complete.** The database is built, secured and tested: 98 tests green.
**Phase 3 (auth + role routing shells) is next** — `apps/` does not exist yet.

```
✅ Phase 0  assessment, architecture, ADRs
✅ Phase 1  monorepo, tooling, shared domain core + 33 tests
✅ Phase 2  schema, RLS, RPC functions, seed data + 65 tests
⬜ Phase 3  auth + role routing shells                 ← NEXT
⬜ Phase 4  core slice: browse → order → canteen accepts → live status
⬜ Phase 5  delivery partner
⬜ Phase 6  admin dashboard
⬜ Phase 7  ratings, favourites, coupons, complaints, analytics
⬜ Phase 8  push, Razorpay, Sentry, deploy
```

Full plan: [`docs/roadmap.md`](./docs/roadmap.md).

## What exists

```
package.json            npm workspaces root; scripts below
tsconfig.base.json      strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
eslint.config.js        flat config, typescript-eslint recommended
vitest.config.ts        packages/**/test, apps/**/test, supabase/test
.env.example            SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY
docs/architecture.md    the living architecture document
docs/decisions/         ADRs 001–007
packages/shared/        the domain core
supabase/               migrations, seed, RPC functions, database tests
```

`apps/mobile` and `apps/admin` do **not** exist yet. They arrive in Phase 3.

### `packages/shared` — the domain core

Consumed as TypeScript source (no build step). Everything else depends on it.

| Module             | Holds                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| `brand.ts`         | Product name, tagline, locale. Rename the product here and nowhere else.  |
| `money.ts`         | Integer paise. `formatPaise`, `rupeesToPaise`. Throws on non-integers.    |
| `roles.ts`         | `student` \| `canteen` \| `delivery` \| `admin`                           |
| `order-status.ts`  | **The order state machine.** Transition table, actor permissions, labels. |
| `payment.ts`       | Payment statuses, methods, transition table                               |
| `pricing.ts`       | `computeTotals`, coupon maths. The only place order money is computed.    |
| `rules.ts`         | `validateOrderPlacement` — cart rules, mirrored in SQL                    |
| `errors.ts`        | `AppError`, stable error codes, safe user-facing messages                 |
| `notifications.ts` | Notification content per audience × order status                          |
| `config.ts`        | Platform defaults (delivery fee, max quantity, partner payout)            |

### `supabase/` — the database

| File                | Holds                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| `..._schema.sql`    | 19 tables, indexes, `canteens_public` view, `order_transitions` table   |
| `..._rls.sql`       | RLS helpers, policies, grants, `delivery_pool` view, realtime           |
| `..._functions.sql` | `place_order`, `transition_order`, `claim_delivery`, `release_delivery` |
| `seed.sql`          | 4 canteens, 28 menu items, 4 hostels, 3 coupons, platform settings      |
| `seed-users.mjs`    | Accounts via the Auth API, then demo orders through the real RPCs       |
| `test/`             | 65 tests on in-process Postgres — see `test/README.md`                  |

**The RPC surface** (everything else is a plain PostgREST select):

```
place_order(canteen, items, hostel, block, room, idempotency_key, note, coupon, method) -> uuid
transition_order(order_id, to_status, reason?) -> text
claim_delivery(order_id)   -> uuid     -- atomic; raises DELIVERY_ALREADY_CLAIMED
release_delivery(order_id) -> text     -- back to the pool
admin_set_role(profile_id, role)
admin_set_partner_approval(profile_id, approved)
```

## Commands

```bash
npm run verify         # format + lint + typecheck + test — run before finishing work
npm test               # vitest (includes the database tests; no Docker needed)
npm run db:start       # supabase start          (needs Docker)
npm run db:reset       # re-apply migrations + seed.sql
npm run db:seed:users  # demo accounts + demo orders (needs a running Supabase)
npm run db:types       # regenerate packages/shared/src/database.types.ts
npm run db:push        # deploy migrations to the linked project
```

## Rules this codebase follows

1. **Money is integer paise, always.** Never a float. Format only via `formatPaise`.
2. **Business rules live in `packages/shared` and in SQL — never in a component.**
   The SQL copy is authoritative; the TypeScript copy exists for pre-submit UX.
3. **Clients never write `orders.status`.** There is no grant. All movement goes through
   `transition_order` / `claim_delivery`.
4. **Never trust the client** for prices, role, payment status, order ownership or totals.
   `place_order` re-reads prices from the database and ignores anything the client sent.
5. **Every transition is a conditional update** (`WHERE status = <expected>`). Zero rows
   updated means someone else won the race — surface it, don't retry blindly.
6. **Orders snapshot what was charged.** Item name and unit price are copied into
   `order_items` at purchase. Never join to `menu_items` for a historical price.
7. **Every new table gets RLS and a policy in the same migration.** Two tests enforce this.
8. **Anything that must never be client-writable is withheld at the `GRANT`**, not the
   policy — policies cannot restrict columns.
9. **Realtime invalidates TanStack Query keys**; it never patches component state directly.
10. **Errors surface as `AppError`.** SQL raises `'CODE: detail'`; `toAppError()` parses the
    prefix. A new code in SQL needs the same code in `errors.ts`.
11. **Vertical slices.** A working end-to-end path beats twenty half-built screens.

## Decisions already made (do not re-litigate without a reason)

| Area            | Choice                                                        | ADR |
| --------------- | ------------------------------------------------------------- | --- |
| Mobile          | One Expo app, `expo-router` route groups per role             | 001 |
| Backend         | Supabase; business logic in Postgres `SECURITY DEFINER` funcs | 002 |
| Database        | Postgres; integer paise; snapshotted order history            | 003 |
| State           | TanStack Query (server) + Zustand (cart only)                 | 004 |
| Order lifecycle | 9 statuses, explicit transition table, **pull-based** claim   | 005 |
| Payments        | COD first; Razorpay behind server-side webhook verification   | 006 |
| DB testing      | PGlite in-process Postgres; no Docker required                | 007 |
| Admin           | Next.js App Router on Vercel                                  | —   |
| API style       | PostgREST for reads, RPC for rule-bearing writes. No GraphQL. | 002 |

Departures from the original brief, all argued in the ADRs:

- `out_for_delivery` merged into `picked_up` — one tap, not two (ADR 005).
- Delivery assignment is a **pull** from an open pool, not a dispatcher push (ADR 005).
- Role comes from a `security definer` lookup, **not** a custom JWT claim — a claim needs
  an auth hook outside the migrations and goes stale until refresh (architecture.md §4).
- `campus_id` / `delivery_batch_id` were **not** added. A column with one possible value
  buys nothing; both are one-line `alter table`s when actually needed.
- Notification rows store `(audience, status)`, not text. Wording is rendered client-side
  from `notifications.ts` so in-app and push cannot drift.

## Known gap

PGlite is single-connection, so the race tests verify the **guard** sequentially (A claims,
B is refused) rather than firing two transactions in parallel. The atomicity is Postgres's
own, but when Docker is available, re-run the claim scenario against `supabase start` with
two connections. Documented in [`supabase/test/README.md`](./supabase/test/README.md).

## Next session: start here

Phase 3 — auth and role routing:

1. `apps/mobile`: Expo + `expo-router`, route groups `(auth)`, `(student)`, `(canteen)`,
   `(delivery)`. Session in `expo-secure-store`. A root layout that reads the profile role
   and mounts the matching group.
2. `apps/admin`: Next.js App Router, middleware-guarded routes, cookie session.
3. `packages/shared/src/database.types.ts` via `npm run db:types` so the client is typed
   against the real schema.
4. Design tokens and the base component set (button, card, badge, status pill, empty /
   loading / error states) — Phase 4 composes these rather than inventing them.
5. Wrap supabase-js calls so every failure goes through `toAppError`.

Keep `npm run verify` green, then update this file's status table and `docs/roadmap.md`.
