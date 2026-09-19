# Canteza — project state

**Read this first in a new session.** Product and architectural background is in
[`context.md`](./context.md); the reasoning behind each choice is in
[`docs/decisions/`](./docs/decisions/).

---

## Where the project is right now

**Phase 7 complete.** 315 tests green offline, plus 59/59 live checks
(`npm run verify:live`) covering auth, realtime, the full order path, RLS, menu
management, order history and engagement. Every admin page has been driven in a
browser against real data. **Phase 8 (push, Razorpay, Sentry, deploy) is next.**

> **Commits are yours.** Never run `git commit` here — finish the work, run
> `npm run verify`, and hand it over.

```
✅ Phase 0  assessment, architecture, ADRs
✅ Phase 1  monorepo, tooling, shared domain core + 33 tests
✅ Phase 2  schema, RLS, RPC functions, seed data + 107 tests (ADR 008 rework + audit)
✅ Phase 3  typed data access, auth, role routing, both app shells + 22 tests
✅ Phase 4  browse -> cart -> checkout -> order -> canteen board -> live status + 14 tests
✅ Phase 5  delivery queue, claim, pickup, deliver, shift toggle, record + 17 tests
✅ Phase 6  admin: orders, canteens, staff, accounts, hostels, revenue + 99
✅ Phase 7  menu, history, ratings, reorder, favourites, coupons, support
⬜ Phase 8  push, Razorpay, Sentry, deploy                          ← NEXT
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
docs/decisions/         ADRs 001–008
packages/shared/        the domain core
supabase/               migrations, seed, RPC functions, database tests
```

```
apps/mobile/            Expo + expo-router. Student / Canteen / Delivery
apps/admin/             Next.js 16 App Router (src/proxy.ts, not middleware.ts)
packages/api/           Typed data access: client, auth, error mapping, query keys
scripts/gen-types.mjs   Generates database.types.ts from the migrations, no Docker
scripts/verify-live.mjs Live checks against a real project, anon key only
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

| File                                 | Holds                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `..._schema.sql`                     | 19 tables, indexes, `canteens_public` view, `order_transitions` table    |
| composite FK                         | `orders (delivery_partner_id, canteen_id)` -> `delivery_partners`        |
| `..._rls.sql`                        | RLS helpers, policies, column-level grants, realtime                     |
| `..._functions.sql`                  | `place_order`, `transition_order`, `claim_delivery`, `release_delivery`  |
| `..._student_default_address.sql`    | `profiles.default_hostel_id/block/room`, all-or-nothing                  |
| `..._delivery_shift_toggle.sql`      | `is_online` gates the queue and claiming; `OFF_SHIFT` error              |
| `..._harden_default_privileges.sql`  | **Security.** Revokes Supabase's blanket grants, restates the real ones  |
| `..._admin_set_partner_active.sql`   | Admin ends or restores a delivery posting; canteen id is explicit        |
| `..._canteen_column_grants.sql`      | **Security.** Staff write hours + pause only; admin writes via RPC       |
| `..._canteen_create.sql`             | `admin_create_canteen`; canteens lose client INSERT and DELETE           |
| `..._canteen_staff_attach.sql`       | Attach/detach staff; writes the role with the row. RPC-only table        |
| `..._delivery_partner_guards.sql`    | Onboarding works on a disabled canteen; refuses counter staff            |
| `..._profiles_and_hostels_admin.sql` | `admin_set_profile_active`; no self-demotion; hostels lose DELETE        |
| `..._revenue_view.sql`               | `revenue_by_canteen_day`, **security_invoker** so RLS scopes it          |
| `..._service_role_grants.sql`        | **Security.** States what service_role may do; nothing granted it before |
| `seed.sql`                           | 4 canteens, 28 menu items, 4 hostels, 3 coupons, platform settings       |
| `seed-users.mjs`                     | Accounts via the Auth API, then demo orders through the real RPCs        |
| `test/`                              | 173 tests on in-process Postgres — see `test/README.md`                  |

**The RPC surface** (everything else is a plain PostgREST select):

```
place_order(canteen, items, hostel, block, room, idempotency_key, note, coupon, method) -> uuid
transition_order(order_id, to_status, reason?) -> text
claim_delivery(order_id)   -> uuid     -- atomic; raises DELIVERY_ALREADY_CLAIMED
release_delivery(order_id) -> text     -- back to the pool
admin_set_role(profile_id, role)
admin_set_partner_canteen(profile_id, canteen_id, approved)   -- onboard or transfer
admin_set_partner_active(profile_id, canteen_id, active)      -- admin retires or restores
admin_update_canteen(canteen_id, name, description, phone, image_url,
                     min_order_paise, opens_at, closes_at, accepting)
admin_set_canteen_active(canteen_id, active)                  -- disable, never delete
admin_create_canteen(name, description, phone, image_url,
                     min_order_paise, opens_at, closes_at) -> uuid  -- starts disabled
admin_attach_canteen_staff(profile_id, canteen_id)   -- moves them if already posted
admin_detach_canteen_staff(profile_id, canteen_id)   -- and puts the role back
admin_set_profile_active(profile_id, active)         -- suspend; never yourself
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
npm run verify:live    # 34 checks on the live project: auth, realtime, order path, RLS
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
- **No admin page for coupons.** `coupons_admin` lets an admin do anything to the table
  and nothing in the dashboard does; codes are created in SQL. A page, no migration.
- **Nothing reads `notifications`.** `notify_order` writes a row per transition and
  `keys.ts` reserves the query key, but there is no API function and no inbox. Phase 8
  covers _push_; the in-app list is unowned.
- **No student search.** context.md §2 promises browse **and search**; `home.tsx` lists
  canteens with no search input, and there is no cross-canteen dish search.
- **The mobile app has never run against the live project.** Every admin page has now
  been driven in a browser against real data, but `apps/mobile` has only ever been
  bundled, not run — no student has placed an order from a device, and the realtime
  tracker has only been proven from Node. That needs Expo on a phone or simulator.
  The counter's menu screen is in the same position: the **data path underneath it is
  proven live** (`verify:live` §5, seven checks through real canteen and student
  sign-ins) and it compiles into the Android bundle, but nobody has tapped the buttons.
  Running it needs a device — `expo start --web` would want `react-native-web` and
  `react-dom`, two dependencies this app does not have and should not grow for a test.
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

**This has been done.** A hosted project is linked by `.env` (gitignored), the schema and
seed are pushed, and `npm run verify:live` passes 34/34. Re-run it after any migration.

`scripts/verify-live.mjs` uses the **anon key and real sign-ins only** — never the service
role key, because a script that can bypass RLS cannot test it. That is the difference from
`seed-users.mjs`, which is server-side and does bypass it.

Four defects were only ever findable this way, all fixed:

1. **`service_role` had no privileges on any of our tables.** Every server-side call
   returned 42501. `harden_default_privileges.sql` said service_role was "left alone on
   purpose" — but left alone meant never granted, and Supabase's bootstrap grants do not
   reach tables a later `db push` creates. The PGlite harness had been _modelling_ a
   default grant that does not exist, so the suite was green while the platform was
   broken. Fixed in `..._service_role_grants.sql`; the harness no longer pretends, and
   `privileges.test.ts` pins it.
2. **`seed-users.mjs` created delivery partners with no canteen.** Stale since ADR 008
   made delivery canteen-scoped; `delivery_partners.canteen_id` is NOT NULL. The harness
   never exercised this file, so nothing caught it.
3. **The seeder could only run between 08:00 and 22:00 IST**, because `place_order`
   refuses a closed canteen and `seed.sql` sets real hours. It now opens the canteens for
   the duration and restores them in a `finally`, the same trick `seedCampus` uses.
4. **A realtime race, in the verification script itself.** `SUBSCRIBED` means the channel
   joined, not that the `postgres_changes` filter is registered with the replication
   worker. An INSERT in that gap is never delivered, which looks exactly like a broken
   publication. The script now settles before acting.

### What the browser pass added

Driving all seven admin pages against live data closed the last unverified claims, and
found two more defects that no offline test could reach:

5. **`seed-users.mjs` was not re-runnable.** `place_order` is idempotent and hands back
   the _existing_ order, so a second run replayed transitions against an already-delivered
   order and died on `INVALID_TRANSITION: delivered -> accepted`. It now finds where each
   order already sits on its own path and only walks the remainder, which also repairs a
   run that failed halfway. The review insert needed `on_conflict=order_id` for the same
   reason.
6. **The overview's "Next" card still advertised Phase 6 as unbuilt**, months of work
   after the fact. Replaced with a short guide to where each page is.

Proven in the browser rather than reasoned about: the `profiles!orders_student_id_fkey`
embed and the `profiles`/`hostels` embeds all resolve; the `or=(...)` search matches on
both `code` and `room` and survives a `#` through URL encoding; `is_within_hours` reports
Night Canteen open at 00:05 IST while every other canteen reads closed; and the campus day
boundary is right where it matters — an order backdated to 00:30 IST on the 20th
(19:00 UTC on the 19th) is excluded from the 19th and included in the 20th, the opposite
of what a naive UTC cutoff gives. `apps/admin/test/order-filters.test.ts` now pins that
case as a regression test.

### First-time setup

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

## Phase 6 screens (admin)

```
app/(dashboard)/layout.tsx        admin gate + nav, written once for every page
app/(dashboard)/page.tsx          overview counts (was app/page.tsx)
app/(dashboard)/orders/page.tsx   search + status/canteen/date filters, 100 newest
app/(dashboard)/orders/[id]/      one order: people, address, items, money, trail
app/(dashboard)/canteens/         list with live open/closed, disable/enable
app/(dashboard)/canteens/[id]/    edit: name, hours, min order, pause switch
app/(dashboard)/canteens/new/     create; the canteen starts disabled
app/(dashboard)/canteens/canteen-fields  the form both of them render
app/(dashboard)/canteens/staff-section   who works this counter, attach/detach
app/(dashboard)/canteens/delivery-section who delivers for it, onboard/retire
app/(dashboard)/students/         every account: search, role, suspend/restore
app/(dashboard)/hostels/          buildings and their blocks, edited in place
app/(dashboard)/analytics/        revenue per canteen over a campus date range
src/lib/people-filters.ts         account search + blocks text[], pure and tested
app/(dashboard)/canteens/actions  the first server actions in this repo
src/lib/order-filters.ts          URL -> query, pure and tested
src/lib/canteen-form.ts           FormData -> RPC args, pure and tested
src/lib/format.ts                 campus-time dates, status text, badge tone
```

**How the admin pages are built, and why** — settled when Phase 6 started, so later
pages match rather than inventing a second way:

- **Server components read; server actions write.** No `QueryClientProvider` in
  `apps/admin`, no client fetching, no admin module in `packages/api`. ADR 004's
  TanStack Query is the _mobile_ pattern; a dashboard that re-renders on navigation
  does not need a second copy of the data in a client cache.
- **Filters live in the URL, never in state.** A filtered view is then a link an admin
  can paste to someone, and the page stays a server component. The filter form is a
  plain `method="get"`, so it works with no JavaScript and needs no handler.
- **A search term is interpolated into a PostgREST `or=(...)` string**, which is the one
  place in this app where user input reaches a query expression rather than a parameter.
  `parseOrderFilters` reduces it to `[a-z0-9#-]` — a comma would start a new condition
  and `*` is the ilike wildcard. That is what `apps/admin/test/order-filters.test.ts`
  exists to hold down.
- **Dates are campus time, explicitly.** Vercel and Supabase both run UTC, so a bare
  `2026-09-19` bound would cut the day at 05:30 IST. `CAMPUS_UTC_OFFSET` in
  `packages/shared/config.ts` is the only place that offset is written.
- **A badge's tone comes from `statusTone()`**, never from a page. Delivered reads green,
  cancelled and rejected read red, anything still moving keeps the default — otherwise a
  scan list renders every outcome in the same orange.
- **A write goes through an RPC, and its outcome comes back in the URL.** Server actions
  here never `update` a table directly and never return state to a client component:
  they call a `security definer` function and `redirect` with `?error=` or `?saved=`.
  That keeps every admin page a server component and makes a failed save a link.
- **An aggregate view is `security_invoker`.** `revenue_by_canteen_day` runs with the
  caller's privileges, so `orders_read` scopes it: an admin sees the platform, a canteen
  sees only its own takings. A normal view runs as its owner and would have handed every
  caller the whole platform's money. `canteens_public` is deliberately the other kind —
  its own `where is_active` is the filter, and there is nothing private in it.
- **Nothing an admin does may lock the platform out of its own administration.** An
  admin cannot demote or suspend themselves — a sole admin doing either leaves no path
  back, since every route to `role` and `is_active` requires an admin. The database
  refuses both; the page also declines to render the controls on your own row.
- **The name search uses `.ilike()` on one column, not `or=(...)`.** Names contain
  spaces, and a space inside a PostgREST `or` group needs quoting rules that are easy to
  get wrong. One parameterised filter has no injection surface at all, and the cost is
  that phone is not searched in the same query.
- **A person is counter staff or a delivery partner, never both.** Each onboarding
  function refuses the other's rows (`ALREADY_DELIVERY_PARTNER`, `ALREADY_CANTEEN_STAFF`).
  Not tidiness: `transition_order` resolves the actor admin → canteen → delivery, so
  someone holding both acts as canteen on their own canteen's orders and could claim a
  delivery they can then never mark picked up. The guard must exist on **both** sides —
  it only had one until Phase 6 built the delivery UI.
- **Staffing works on a disabled canteen.** A canteen is created switched off so its
  people and menu go in first, so neither `admin_attach_canteen_staff` nor
  `admin_set_partner_canteen` may require `is_active` — only that the canteen exists.
- **A membership and a role are written together, or not at all.** `my_canteen_id()`
  reads `canteen_staff` and never looks at `profiles.role`: the row grants the data, the
  role picks the app. `admin_attach_canteen_staff` writes both, which is why
  `canteen_staff` has no client write grant either. Neither function will demote an
  admin who also works a counter.
- **A canteen is disabled, never deleted.** `canteens` now has no client INSERT or
  DELETE grant at all: creating goes through `admin_create_canteen` and retiring through
  `admin_set_canteen_active`. Deleting a canteen would cascade its staff and delivery
  partner rows and orphan `orders.canteen_id`, so the table simply does not offer it.
- **A mutating control is a `<form>`, never a `<Link>`.** The disable switch POSTs. A GET
  that changes state gets fired by any prefetcher that touches the page.
- **`proxy.ts` must live in `src/`.** This app has a `src/` directory, so Next looks for
  `src/proxy.ts` and silently ignores one at the package root — no warning, no error, the
  file simply never runs. It sat unregistered from Phase 3 until Phase 6 caught it: the
  login redirect never fired and, worse, the session was never refreshed. The build
  output printing `ƒ Proxy (Middleware)` is the check that it is wired up.

## Phase 7 screens

```
admin   app/(dashboard)/canteens/[id]/menu/    add, edit, retire, restore a dish
admin   app/(dashboard)/support/               the complaints queue: status + resolution
admin   src/lib/menu-form.ts                   FormData -> a row, pure and tested
mobile  app/(canteen)/menu.tsx                 the counter's own menu
mobile  app/(student)/my-orders.tsx            order history
mobile  app/(student)/support.tsx              file a complaint, read the answer
mobile  app/(student)/order/[id].tsx           + rate, + reorder, + report a problem
mobile  app/(student)/canteen/[id].tsx         + a heart on every dish
mobile  app/(student)/home.tsx                 + the favourites strip
mobile  app/(student)/checkout.tsx             + the coupon field
api     catalog.ts     listCanteenMenu / createMenuItem / updateMenuItem
api     engagement.ts  reviews, favourites, coupons, tickets
shared  money.ts   parsePriceRupees            the price rule, both surfaces
shared  time.ts    formatCampusDateTime        campus time, both surfaces
shared  pricing.ts normaliseCouponCode         matches place_order's upper(trim())
```

**Two surfaces, one table, and they are not the same screen.** The admin page is for
stocking a canteen — categories, sort order, image, description — which happens once,
before anyone is posted to the counter. The counter's screen is built around the one
thing that happens during service: the samosas run out and someone says so in one tap.
So a dish collapsed on mobile shows its sold-out switch and nothing else, and the name
and price hide behind a tap. Adding a dish there asks for a name and a price only; the
rest is setup the admin already did.

`listCanteenMenu` is a separate query key (`queryKeys.canteenMenu`) from the student's
`useMenu`, because the same canteen id would otherwise cache the filtered list and the
full one over each other and whichever screen loaded second would show the wrong one.

**Order history is `my-orders.tsx`, not `orders.tsx`** — rule 19, met for real rather
than in the abstract. `(canteen)/orders.tsx` already resolves to `/orders`, so a second
`orders.tsx` in `(student)` would have been the same route, and a student tapping
through would have landed on the counter's board. It reads `listMyOrders`, which was
written in Phase 4 and had never had a caller. No student id appears in that query:
`orders_read` is what limits it, and `verify:live` §6 is where that is proven rather
than assumed.

`formatCampusDateTime` moved from `apps/admin/src/lib/format.ts` to
`packages/shared/time.ts` when the phone needed the same rule — the campus timezone is
applied in one place. The admin file re-exports it, so every import there is unchanged.

**Engagement is policy all the way down.** Ratings, favourites, coupon reads and
complaints are plain table writes with no RPC anywhere, because each already carries a
policy that says exactly who may write what. The strictest is `reviews_insert_own`,
which checks in SQL that the order is the writer's own _and_ delivered _and_ from the
canteen being rated — a `security definer` function would have restated that in a
second place and could drift from it. `verify:live` §7 is where that bet is settled,
with real sign-ins.

Four things worth keeping straight:

- **`favorites` gets an `insert`, never an `upsert`.** The table is nothing but its
  primary key, so it has no UPDATE grant — and PostgREST's upsert is
  `insert ... on conflict do update`, which asks for one and is refused with 42501. A
  duplicate key means the dish is already a favourite, which is the outcome wanted, so
  `addFavorite` swallows 23505 and nothing else.
- **The checkout does not show the discount.** `place_order` applies it — re-reading the
  coupon, checking the minimum and the per-student limit, capping it at the subtotal —
  so a figure computed on the phone would be a guess that disagrees with the receipt the
  moment a rule bites. The field sends a code; the order screen shows what was allowed.
- **Reorder copies ids and quantities, and nothing else** (rule 17), so it is charged at
  today's prices rather than the receipt's. Retired and sold-out dishes are dropped,
  because `place_order` re-reads every price from `menu_items` and a line pointing at a
  dish that is off the menu cannot be priced at all. The screen says so before you tap.
- **A student can file a complaint and read the answer, but never resolve it.**
  `support_tickets_admin` is the only UPDATE policy, so a student updating their own
  ticket filters to zero rows rather than erroring.

**Where this one departs from the Phase 6 pattern, and why.** Every other admin write in
this app goes through a `security definer` RPC, because `canteens`, `profiles` and
`delivery_partners` all withhold columns at the `GRANT` and a Postgres grant is per role
— an admin is `authenticated` like everyone else. `menu_items` withholds nothing: a price
is exactly what the counter is meant to write, and `menu_items_admin` /
`menu_items_own_canteen` already carry the WITH CHECK. So this is a plain table write,
the same call `hostels/actions.ts` makes and for the same stated reason. What was missing
was never the authorisation — it was any code at all that wrote the table.

Three things the page settles:

- **An item is retired, never deleted.** `order_items.menu_item_id` references it with no
  `on delete` clause, so Postgres refuses to remove anything anyone has ordered — the FK
  is kept on purpose (snapshot for display, FK for reorder and analytics). Retiring is the
  only retirement path, and `listMenu` filters `is_active`, so it leaves every menu.
- **Sold out and retired are different states.** `is_available` hides an item for today
  and keeps it on the menu — `listMenu` deliberately returns it so a student sees Maggi
  greyed out rather than silently absent. The item count badge counts the live ones.
- **Each item is a `<details>`.** A menu is a list to scan and occasionally one row to
  edit; 28 open forms would bury it. Native, so the page stays a server component.

## Next session: Phase 7

Phase 6 is finished — what it built and why is above. The five areas it covered, for
reference when extending them:

1. ~~**Orders**: search, filter, status history trail.~~ ✅ done
2. ~~**Canteens**: create, edit hours, disable.~~ ✅ done. A new canteen is created
   **disabled** and has no staff and no menu, so the admin adds both and then enables it
   from the list. Attaching a staff account is still missing — it belongs with the users
   page, because `canteen_staff_one_canteen` makes "attach" sometimes mean "move".
3. ~~**Delivery staff**: onboard, transfer, retire, restore.~~ ✅ done, as a section on
   the canteen's own page. A new posting starts **off shift** — the partner goes online
   themselves, and `is_online` is the one column on that table a client may write.
4. ~~**Students, hostels**: manage.~~ ✅ done. `/students` is every account, not only
   students — a role change is how someone becomes staff. Names and phones stay
   read-only: the grant permits writing them, but they are the person's own details.
   The admin app cannot see anyone's **email** — that lives in `auth.users`, which
   PostgREST does not expose — so people are identified by name and phone. If that is
   not enough to tell two students apart, the fix is a view or an RPC, not a client read.
5. ~~**Analytics**: revenue.~~ ✅ done, from `revenue_by_canteen_day`. **The formula this
   file used to state was wrong**: "subtotal + (delivery − platform)" ignores the
   discount and so overstates the canteen's take on any order with a coupon. What the
   canteen actually receives is `total_paise − platform_fee_paise`, because `total` is
   what the student paid. Discounts are reported as their own figure rather than netted
   into either side, since who funds them is still open (ADR 008).

Two things the orders page deliberately does not do: **no pagination** (100 newest, and
it says so when it truncates — add a cursor when a real dataset makes that bite), and
**no "you are here" in the nav**, because highlighting it would make the nav a client
component for one line of styling. The accounts page has the same 100-row ceiling.

**Phase 7 is done.** Menu management on both surfaces, order history, ratings, reorder,
favourites, coupons at checkout and complaints end to end — see Phase 7 screens above.
Both admin pages were driven in a browser against the live project; the mobile screens
have their data paths proven by `verify:live` §§5–7 but have never been tapped on a
device.

The shared piece worth knowing about: **`parsePriceRupees` lives in `money.ts`**, not in
either app. The rule it encodes is that `price_paise > 0` has to be checked _after_ the
conversion, because 0.004 is a positive number of rupees that rounds to zero paise — a
naive check on the typed value passes something the column rejects. The admin form and
the counter's text input ask the same question, so it is written once (rule 1, rule 2).

Two notes that outlived the work:

- **Coupon funding is settled: the canteen absorbs every discount**, including a code an
  admin issued; the platform's ₹2 of the delivery fee is never touched by one (ADR 008).
  The maths already worked this way — `total_paise` is net of the discount and
  `platform_fee_paise` is flat — so nothing in `place_order` or `revenue_by_canteen_day`
  changed when it was decided.
- **There is still no admin page for coupons.** A student can use a code and the
  checkout offers whatever `coupons_read` returns, but creating or retiring one is a SQL
  statement today. `coupons_admin` already grants an admin everything, so it is a page
  and no migration — it lands whenever someone needs to run a promotion.

**Still unverified:** `apps/mobile`. The database, the API layer and the whole admin
dashboard are proven against the live project; the Expo app is not. Run
`npm run dev:mobile` with `EXPO_PUBLIC_SUPABASE_*` set, sign in as riya@campus.edu /
campus1234, place an order, and watch it reach main.canteen@campus.edu and vikram@campus.edu.

Keep `npm run verify` green, then update this file and `docs/roadmap.md`. **Do not
commit** — leave the work staged for review.
