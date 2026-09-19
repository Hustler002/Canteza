# Canteza — project state

**Read this first in a new session.** Product and architectural background is in
[`context.md`](./context.md); the reasoning behind each choice is in
[`docs/decisions/`](./docs/decisions/).

---

## Where the project is right now

**Phase 5 complete.** The full order path now runs student -> canteen -> partner: 181 tests green.
**Phase 6 (admin dashboard) is next.**

> **Commits are yours.** Never run `git commit` here — finish the work, run
> `npm run verify`, and hand it over.

```
✅ Phase 0  assessment, architecture, ADRs
✅ Phase 1  monorepo, tooling, shared domain core + 33 tests
✅ Phase 2  schema, RLS, RPC functions, seed data + 95 tests (ADR 008 rework + audit)
✅ Phase 3  typed data access, auth, role routing, both app shells + 22 tests
✅ Phase 4  browse -> cart -> checkout -> order -> canteen board -> live status + 14 tests
✅ Phase 5  delivery queue, claim, pickup, deliver, shift toggle, record + 17 tests
⬜ Phase 6  admin dashboard                                             ← NEXT
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
supabase/tsconfig.json  so `npm run typecheck` actually covers the database tests
.env.example            SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY
docs/architecture.md    the living architecture document
docs/decisions/         ADRs 001–007
packages/shared/        the domain core
supabase/               migrations, seed, RPC functions, database tests
```

```
apps/mobile/            Expo + expo-router. Student / Canteen / Delivery
apps/admin/             Next.js 16 App Router (proxy.ts, not middleware.ts)
packages/api/           Typed data access: client, auth, error mapping, query keys
scripts/gen-types.mjs   Generates database.types.ts from the migrations, no Docker
```

### `packages/shared` — the domain core

Consumed as TypeScript source (no build step). Everything else depends on it.

| Module              | Holds                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| `brand.ts`          | Name, tagline, support email, locale. The **only** place the name lives.  |
| `money.ts`          | Integer paise. `formatPaise`, `rupeesToPaise`. Throws on non-integers.    |
| `roles.ts`          | `student` \| `canteen` \| `delivery` \| `admin`                           |
| `order-status.ts`   | **The order state machine.** Transition table, actor permissions, labels. |
| `payment.ts`        | Payment statuses, methods, transition table                               |
| `pricing.ts`        | `computeTotals`, coupon maths. The only place order money is computed.    |
| `rules.ts`          | `validateOrderPlacement` — cart rules, mirrored in SQL                    |
| `errors.ts`         | `AppError`, stable error codes, safe user-facing messages                 |
| `notifications.ts`  | Notification content per audience × order status                          |
| `config.ts`         | Platform defaults (delivery fee, max quantity, platform fee)              |
| `database.types.ts` | **Generated.** `npm run db:types`. Never edit by hand.                    |

### `packages/api` — typed data access

| Module        | Holds                                                                        |
| ------------- | ---------------------------------------------------------------------------- |
| `client.ts`   | `createCampusClient({ url, anonKey, storage })`. Refuses a service role key. |
| `auth.ts`     | `signIn/signUp/signOut`, `getIdentity()` -> role + canteen from the DB       |
| `errors.ts`   | `mapSupabaseError`, `unwrap` — every failure becomes an `AppError`           |
| `keys.ts`     | The single TanStack Query key registry                                       |
| `catalog.ts`  | Canteens, menus, hostels, the student's default address                      |
| `orders.ts`   | `placeOrder`, `transitionOrder`, order reads with embedded items             |
| `realtime.ts` | `subscribeToOrders` + `orderFilters`. Hands back no payload, by design       |
| `delivery.ts` | Queue, claim/release, shift toggle, `summariseDeliveries` (counts, not pay)  |

### `supabase/` — the database

| File                                | Holds                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `..._schema.sql`                    | 19 tables, indexes, `canteens_public` view, `order_transitions` table   |
| composite FK                        | `orders (delivery_partner_id, canteen_id)` -> `delivery_partners`       |
| `..._rls.sql`                       | RLS helpers, policies, column-level grants, realtime                    |
| `..._functions.sql`                 | `place_order`, `transition_order`, `claim_delivery`, `release_delivery` |
| `..._student_default_address.sql`   | `profiles.default_hostel_id/block/room`, all-or-nothing                 |
| `..._delivery_shift_toggle.sql`     | `is_online` gates the queue and claiming; `OFF_SHIFT` error             |
| `..._harden_default_privileges.sql` | **Security.** Revokes Supabase's blanket grants, restates the real ones |
| `seed.sql`                          | 4 canteens, 28 menu items, 4 hostels, 3 coupons, platform settings      |
| `seed-users.mjs`                    | Accounts via the Auth API, then demo orders through the real RPCs       |
| `test/`                             | 95 tests on in-process Postgres — see `test/README.md`                  |

**The RPC surface** (everything else is a plain PostgREST select):

```
place_order(canteen, items, hostel, block, room, idempotency_key, note, coupon, method) -> uuid
transition_order(order_id, to_status, reason?) -> text
claim_delivery(order_id)   -> uuid     -- atomic; raises DELIVERY_ALREADY_CLAIMED
release_delivery(order_id) -> text     -- back to the pool
admin_set_role(profile_id, role)
admin_set_partner_canteen(profile_id, canteen_id, approved)   -- onboard or transfer
canteen_set_partner_active(profile_id, active)                -- canteen retires own staff
```

## Commands

```bash
npm run verify         # format + lint + typecheck + test — run before finishing work
npm test               # vitest (includes the database tests; no Docker needed)
npm run db:start       # supabase start          (needs Docker)
npm run db:reset       # re-apply migrations + seed.sql
npm run db:seed:users  # demo accounts + demo orders (needs a running Supabase)
npm run db:types       # regenerate database.types.ts from the migrations (no Docker)
npm run dev:mobile     # expo start
npm run dev:admin      # next dev
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
   policy — policies cannot restrict columns. This only works because
   `..._harden_default_privileges.sql` first revokes the blanket grants Supabase hands
   `anon`/`authenticated` on every table in `public`. **Change privileges in that
   migration**, not in the earlier RLS one, which the revoke supersedes.
9. **Realtime invalidates TanStack Query keys**; it never patches component state directly.
10. **Errors surface as `AppError`.** SQL raises `'CODE: detail'`; `toAppError()` parses the
    prefix. A new code in SQL needs the same code in `errors.ts`.
11. **Wrap helper calls in RLS policies**: `(select public.is_admin())`, not
    `public.is_admin()`. Unwrapped, Postgres re-evaluates it per row.
12. **A cancelled order consumes nothing** — no coupon, no payment. Whatever
    `place_order` reserved, the terminal transition releases.
13. **Never hand-edit `database.types.ts`.** Change a migration, run `npm run db:types`.
14. **No literal colours or spacings in a component.** Read tokens from `useTheme()`
    (mobile) or the CSS variables in `globals.css` (admin).
15. **Role routing is ergonomics, not security.** RLS is the boundary. A patched
    client gets a different menu and no extra data.
16. **Never write the product name in a component.** Import `BRAND` from
    `@canteza/shared`. The product is Canteza; `CampusEats` was the placeholder in the
    original brief and now appears nowhere in the repo.
17. **The cart stores item ids and quantities only.** No prices, no names, no total.
    `place_order` re-reads every price server-side, so a price here would be a lie
    waiting to happen.
18. **Action buttons come from `nextStatusesFor(status, actor)`**, never a hand-written
    list, so a screen cannot offer a move the database would refuse.
19. **Route groups do not appear in the URL.** `app/(student)/home.tsx` is `/home`.
    Give each role group a distinct filename — three `index.tsx` files would all
    resolve to `/`.
20. **Vertical slices.** A working end-to-end path beats twenty half-built screens.

## Decisions already made (do not re-litigate without a reason)

| Area            | Choice                                                        | ADR |
| --------------- | ------------------------------------------------------------- | --- |
| Mobile          | One Expo app, `expo-router` route groups per role             | 001 |
| Backend         | Supabase; business logic in Postgres `SECURITY DEFINER` funcs | 002 |
| Database        | Postgres; integer paise; snapshotted order history            | 003 |
| State           | TanStack Query (server) + Zustand (cart only)                 | 004 |
| Order lifecycle | 9 statuses, explicit transition table                         | 005 |
| Delivery        | **Canteen-scoped** partners; claim from own canteen's queue   | 008 |
| Revenue         | ₹2 of the ₹10 delivery fee. Nothing on food.                  | 008 |
| Payments        | COD first; Razorpay behind server-side webhook verification   | 006 |
| DB testing      | PGlite in-process Postgres; no Docker required                | 007 |
| Admin           | Next.js App Router on Vercel                                  | —   |
| API style       | PostgREST for reads, RPC for rule-bearing writes. No GraphQL. | 002 |

Departures from the original brief, all argued in the ADRs:

- `out_for_delivery` merged into `picked_up` — one tap, not two (ADR 005).
- Delivery is **canteen-scoped**, not a campus-wide pool: external couriers cannot enter
  campus, so each canteen employs its own staff (ADR 008, supersedes part of ADR 005).
  `delivery_partner.canteen_id = order.canteen_id` is guaranteed by a **composite foreign
  key**, so a cross-canteen assignment is unrepresentable, not merely rejected.
- A canteen can deliver its own order (`ready → delivered`) when no partner is on shift.
- Role comes from a `security definer` lookup, **not** a custom JWT claim — a claim needs
  an auth hook outside the migrations and goes stale until refresh (architecture.md §4).
- `campus_id` / `delivery_batch_id` were **not** added. A column with one possible value
  buys nothing; both are one-line `alter table`s when actually needed.
- Notification rows store `(audience, status)`, not text. Wording is rendered client-side
  from `notifications.ts` so in-app and push cannot drift.

## Known gaps

- **No timeout on unpaid prepaid orders.** `pending -> accepted` is blocked until payment
  is `success`, but nothing cancels an order the student abandoned at the payment screen;
  it needs a scheduled job and lands with Razorpay in Phase 8.
- **Coupon funding is undecided** — a discount currently comes out of the canteen's share
  even when an admin issued the code. Decide before Phase 7 ships coupons (ADR 008).
- **Nothing has run against a real Supabase yet.** Auth, Realtime and PostgREST are
  exercised only through generated types and the SQL tests. See "Verifying against a
  real database" below — it needs no Docker.
- PGlite is single-connection, so the race tests verify the **guard** sequentially (A claims,
  B is refused) rather than firing two transactions in parallel. The atomicity is Postgres's
  own, but when Docker is available, re-run the claim scenario against `supabase start` with
  two connections. Documented in [`supabase/test/README.md`](./supabase/test/README.md).

## Phase 4 screens

```
app/(student)/home.tsx          canteen list, active-order banner, cart banner
app/(student)/canteen/[id].tsx  menu, add to cart, cross-canteen confirm
app/(student)/cart.tsx          live prices, checkOrderPlacement blocker
app/(student)/checkout.tsx      address (prefilled), place_order, idempotency key
app/(student)/order/[id].tsx    live tracker, cancel while pending
app/(canteen)/orders.tsx        four-tab board, buttons from the state machine
```

## Phase 5 screens

```
app/(delivery)/deliveries.tsx     shift switch, carrying-now list, canteen's queue
app/(delivery)/delivery/[id].tsx  destination large, cash to collect, state-machine buttons
app/(delivery)/history.tsx        completed deliveries + counts (never a rupee figure)
```

**The shift rule worth remembering:** `is_online` hides the queue and refuses new
claims, but never touches an order already in hand. `orders` matches those by
`delivery_partner_id = auth.uid()` and `transition_order` resolves the actor the same
way, so going off shift cannot strand food someone is carrying.

## Verifying against a real database

`supabase start` needs Docker, which this machine does not have — but **`supabase db
push` does not** (it fails with a connection error, not `LegacyDockerRunError`, unlike
`gen types`). So a free hosted project verifies the whole stack with nothing installed:

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push --include-seed        # migrations + seed.sql
npm run db:seed:users                      # accounts + demo orders via the real RPCs
```

`db:seed:users` needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment
and refuses a hosted URL unless `ALLOW_REMOTE_SEED=1` is set. It drives `place_order`,
`transition_order` and `claim_delivery` over HTTP, so a clean run proves PostgREST, Auth
and the RPC surface end to end. Realtime still needs a device or browser watching.

## Next session: start here

Phase 6 — the admin dashboard (`apps/admin`, Next.js 16). The shell, login and
overview counts already work; everything below is new pages against existing data
and permissions:

1. **Orders**: search and filter across every order, with the status history trail.
   Admin can already read all of them (`(select public.is_admin())` in `orders_read`).
2. **Canteens**: create, edit hours, disable. Admin has full grants already.
3. **Delivery staff**: onboard and transfer with `admin_set_partner_canteen`. Note a
   new posting starts **off shift** — the partner goes online themselves.
4. **Students, hostels**: manage. `admin_set_role` is the only path to a role change.
5. **Analytics**: platform revenue is `sum(platform_fee_paise)` on delivered orders —
   our cut only. Canteen revenue is subtotal + (delivery fee − platform fee).

**Still unverified anywhere:** nothing has run against a real Supabase. Realtime,
Auth and PostgREST are exercised only by types and the SQL tests — all of it needs
Docker. The first person with it should run `npm run db:reset && npm run db:seed:users`,
then sign in as riya@campus.edu / campus1234, place an order, and watch it appear on
main.canteen@campus.edu and then vikram@campus.edu.

Keep `npm run verify` green, then update this file and `docs/roadmap.md`. **Do not
commit** — leave the work staged for review.
