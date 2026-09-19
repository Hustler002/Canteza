# Canteza — Implementation roadmap

Vertical slices. Each phase ends with something demonstrable end-to-end, not a set of
half-built screens.

| Phase | Outcome                                                                          | Status  |
| ----- | -------------------------------------------------------------------------------- | ------- |
| 0     | Repository assessment, architecture, ADRs                                        | ✅ done |
| 1     | Monorepo, tooling, shared domain core (state machine, pricing, rules) + tests    | ✅ done |
| 2     | Database schema, RLS, RPC functions, seed data                                   | ✅ done |
| 3     | Auth + role routing (mobile shell, admin shell)                                  | ✅ done |
| 4     | **Core slice:** browse → cart → checkout → order → canteen accepts → live status | ✅ done |
| 5     | Delivery partner: queue, claim, pickup, deliver, earnings                        | ✅ done |
| 6     | Admin dashboard: overview, orders, users, canteens, hostels                      | ✅ done |
| 7     | Menu management, ratings, favourites, reorder, coupons, complaints               | ✅ done |
| 8     | Push notifications, Razorpay, Sentry, EAS/Vercel deploy                          | ⬜ next |

---

## Phase 1 — foundation ✅

Monorepo (npm workspaces), TypeScript strict, ESLint flat config, Prettier, Vitest.
`packages/shared` holds the domain core: `money`, `order-status`, `pricing`, `rules`,
`payment`, `errors`, `notifications`, `brand`, `config`. 33 tests, all green.

Nothing UI-shaped was built here on purpose: every screen in later phases depends on these
rules, and they are the part that must be right.

## Phase 2 — database ✅

Three migrations plus seed data, all executed on in-process Postgres (ADR 007 — no
Docker needed). Later phases added three more migrations; the SQL suite stands at 115
tests.

- `..._schema.sql` — 19 tables, indexes, the `canteens_public` view, and
  `order_transitions`: the state machine stored as data so a test can diff it against
  `packages/shared`.
- `..._rls.sql` — helpers (`auth_role`, `is_admin`, `my_canteen_id`,
  `is_delivery_partner`), RLS on every table, grants that withhold `profiles.role` and
  `delivery_partners.is_approved`/`is_active`/`canteen_id` at the column level.
- `..._functions.sql` — `place_order`, `transition_order`, `claim_delivery`,
  `release_delivery`, `notify_order`.
- Delivery is canteen-scoped (ADR 008): a partner belongs to one canteen, and a composite
  foreign key on `orders` makes a cross-canteen assignment unrepresentable.
- `seed.sql` — four canteens, 28 menu items, four hostels, three coupons.
- `seed-users.mjs` — accounts via the Auth API, then demo orders placed through the real
  RPCs over HTTP.

Exit criteria met: a student cannot read another student's order; a repeated idempotency
key yields one order; a second claim on a taken delivery raises
`DELIVERY_ALREADY_CLAIMED`. The one gap is genuine parallelism — see ADR 007.

## Phase 3 — auth + shells ✅

`packages/api` (typed client, auth, error mapping, query keys), `apps/mobile` (Expo SDK 57,
expo-router route groups per role, chunked SecureStore session) and `apps/admin` (Next 16,
`proxy.ts` session refresh, `getClaims()` not `getSession()`). Types are generated from the
migrations by `scripts/gen-types.mjs` — `supabase gen types` shells out to Docker even with
`--db-url`, so it introspects PGlite instead.

Verified: the Metro bundle resolves the workspace packages (1368 modules, shared domain code
present in the output), and `next build` succeeds with `/` dynamic and `/login` static.

### Original plan

Expo app with `expo-router` route groups per role; Next.js admin with middleware-guarded
routes. Session persistence, logout, role-based landing. Design tokens and the base
component set (button, card, badge, empty/loading/error states) land here so later phases
compose instead of inventing.

## Phase 4 — the core slice

The workflow from §2 of the brief, working for real against the database: student browses,
adds to cart, checks out with hostel/block/room, places the order; the canteen device
receives it over Realtime, accepts, prepares, marks ready; the student watches the status
change live. This is the phase that makes the product real.

## Phase 5 — delivery

The partner's own canteen's ready queue, atomic claim, pickup, deliver, daily history and
earnings. Canteen-scoped throughout (ADR 008). Completes the end-to-end flow.

## Phase 6 — admin ✅

Overview metrics, order search/filter, user and canteen management, hostel management.

**Done:** the signed-in shell (`(dashboard)` route group holds the admin gate and nav
once), order search and filtering across the whole platform, and an order detail page
with the `order_status_history` trail — who moved it, from what, when, and why.

The pattern the rest of the phase follows: server components read, server actions write,
filters live in `searchParams` rather than state so a filtered view is a shareable link.
No client query cache in the admin app; ADR 004 is the mobile pattern.

Also landed here, out of order because the dashboard needs it: `admin_set_partner_active`.
`admin_set_partner_canteen` could hire and transfer delivery staff but nothing could
retire them — `canteen_set_partner_active` is scoped to the caller's own canteen, and
the only UPDATE grant on `delivery_partners` is `is_online`. The SQL and its tests are
in; the UI control lands with the delivery-staff page.

Fixed while verifying the slice: `proxy.ts` was at the admin package root, but this app
uses a `src/` directory, so Next had been ignoring it since Phase 3 — the login redirect
never fired and the session was never refreshed. Moved to `src/proxy.ts`; `next build`
now prints `ƒ Proxy (Middleware)`, which is the check.

**Not yet verified:** no Orders page has rendered a real row. Routing, the redirect, the
stylesheet across breakpoints and the pure functions are checked; the PostgREST embed,
the search and the date bounds need a live database.

Canteens landed next: the list with live open/closed state read from `canteens_public`
(so the midnight-crossing hours logic is never ported into TypeScript), an edit form, and
a disable switch. Disabling hides a canteen from students and keeps every order, menu item
and staff row — nothing operational is hard-deleted.

That slice also closed a grant hole. `canteens_staff_update` claimed staff adjust "hours
and pause switch", but the grant behind it was table-wide, so a canteen account could
rename itself, change its own minimum order, or set `is_active = false`. Column grants are
per role and admins are `authenticated` too, so the fix narrows the grant to
`opens_at, closes_at, is_accepting_orders` for everyone and moves the admin's wider reach
into `admin_update_canteen` / `admin_set_canteen_active` — the same `security definer`
pattern as `admin_set_role`.

Create followed. A new canteen is inserted **disabled**: the column default is `true` and
`canteens_public` exposes a canteen the instant it exists, so the default would have put an
empty, unstaffed canteen on every student's list on day one. Same shape as a new delivery
posting starting off shift — created, then deliberately turned on.

That also let `canteens` give up its last blanket grants. INSERT had exactly one consumer
and it is now `admin_create_canteen`; DELETE never had one, because deleting a canteen
would cascade its staff and delivery-partner rows and orphan `orders.canteen_id`. Both are
revoked, so the table is RPC-only for writes apart from the three staff columns — the same
shape `orders` has had since Phase 2.

Staff attachment closed the loop on creating a canteen: create it disabled, attach an
account, add a menu, enable it. The section sits on the canteen's own page, because that
is where the question comes up and there is no canteen picker to build.

Two things move together there. `my_canteen_id()` reads `canteen_staff` and never looks
at `profiles.role`, so the row is what grants the data while the role only decides which
app the person lands in — writing one without the other gives someone a counter screen
with no data, or a canteen's orders behind a student's menu. Attaching writes both, moves
anyone already posted elsewhere, and refuses a person who still has an active delivery
posting: `transition_order` resolves canteen before delivery, so they could claim a
delivery and then never be able to mark it picked up. `canteen_staff` lost its client
write grant in the same migration.

Delivery staff followed as a second section on the same page, since partners are
canteen-scoped (ADR 008) and the canteen is already in hand. Onboarding moves anyone
already posted elsewhere and keeps the old row retired, because `orders` points at it
through a composite foreign key.

Building the UI surfaced three faults in `admin_set_partner_canteen`, all fixed in one
migration. It required the canteen to be active, which made the create-disabled-then-staff
flow impossible for partners while it already worked for counter staff. It had no guard
against onboarding someone who works a counter — the reverse guard existed, so the broken
pairing was simply reachable from the other side. And it set `role = 'delivery'`
unconditionally, which would have stripped the dashboard from an admin put on a roster.

Accounts and hostels came last before analytics. `/students` lists every account, not
only students, because a role change is how someone becomes counter staff or a partner in
the first place. Hostels edit in place on one page — four rows that rarely change did not
need a detail route.

Two more dead controls turned real. `profiles.is_active` had gated delivery access since
Phase 2 — `my_delivery_canteen_id()` requires it — but no grant and no function could ever
write it, so suspending an account was impossible; `admin_set_profile_active` makes it
work. And `hostels` gave up DELETE: `orders.hostel_id` refuses to drop a hostel with
orders, but one without them vanished cleanly and took every student's saved address with
it through `on delete set null`.

The guard worth naming: an admin can no longer demote or suspend themselves. `admin_set_role`
had written whatever it was given, and a sole admin demoting themselves would have locked
everyone out permanently, because every route back to `role` requires an admin.

Analytics closed the phase. `revenue_by_canteen_day` sums delivered orders per canteen
per campus day, so the page reads canteens × days rather than every order ever placed.
It is a `security_invoker` view, which means `orders_read` scopes it: an admin sees the
platform and a canteen would see only its own takings — a canteen revenue page for free
whenever that is wanted. A plain view runs as its owner and would have handed every
caller the platform's money.

It also corrected a formula this repo had written down twice. "Canteen revenue is
subtotal + (delivery − platform)" ignores the discount, overstating the canteen's take on
any order with a coupon. What a canteen actually receives is `total − platform_fee`.
Discounts are reported as their own figure rather than netted into either side, because
who funds them is still undecided (ADR 008) — and shipping coupons in Phase 7 will force
that decision.

## Phase 7 — menu management and the secondary features

**Menu management comes first**, because it is the one gap that stops the product working
rather than making it nicer. `menu_items` has had full client CRUD grants and both
policies (`menu_items_own_canteen`, `menu_items_admin`) since Phase 2, and the only code
that has ever touched the table reads it. So a canteen cannot add a dish or change a
price, and `admin_create_canteen`'s intended flow — create disabled, attach staff, add a
menu, enable — has no screen for its third step. It is built on **both** surfaces: the
canteen's own screen in `apps/mobile`, because pricing and sold-out are the counter's
daily work, and an admin page, because the admin sets a new canteen up before anyone is
posted to it.

An item is disabled, never deleted — `order_items` snapshots the name and price, but the
FK is kept for reorder and analytics (context.md §5), so a delete would orphan history.
Postgres enforces it: the reference carries no `on delete` clause, so removing an item
anyone has ordered is refused outright.

**Both halves are done.** The admin page was walked in a browser against the live
project: add, edit a price, retire, restore, sold out, the duplicate-name error, and
375px. The counter's screen (`app/(canteen)/menu.tsx`) followed, built around the
sold-out switch rather than the form, because that is the button that gets pressed
during service.

Both are plain table writes rather than RPCs — the same departure `hostels` makes, for
the same reason: `menu_items` withholds no column, so the grant and the two WITH CHECK
policies already say everything a `security definer` function would restate.

That claim is the one worth proving with real sign-ins, and `verify:live` now does, in a
new §5: a canteen adds and prices its own dish, a sold-out dish is still visible to a
student while a retired one is not, and a rival canteen can neither price another
canteen's dish (RLS filters the update to zero rows rather than erroring) nor insert onto
its menu (WITH CHECK refuses outright). **41/41.** The test dish is removed in the
`finally`, alongside the canteen's opening hours.

Then the secondary features. Every table exists from Phase 2 with RLS and client grants:
`reviews`, `favorites`, `coupons`, `coupon_redemptions`, `support_tickets`.

**Student order history is the prerequisite for two of them**, and is now built:
`app/(student)/my-orders.tsx`, reached from the home screen, reading the `listMyOrders`
that had sat in `packages/api/orders.ts` since Phase 4 without a caller. Rating and
reorder hang off it.

It is `my-orders.tsx` rather than `orders.tsx` because route groups do not appear in the
URL and `(canteen)/orders.tsx` already owns `/orders` — the collision rule 19 warns
about, met for real. `verify:live` §6 covers the read: the embed resolves, every order
carries its own line items, and a student's history contains nobody else's orders, which
is `orders_read` doing the work rather than a `where` clause.

Coupons were mostly done server-side already — `place_order` validates the code, the
minimum, `max_redemptions` and `per_student_limit`, caps the discount at the subtotal and
writes `coupon_redemptions`; the terminal transition hands the redemption back (rule 12).
What landed was the checkout field, a read of the usable codes, and nothing else: the
screen deliberately shows no discount figure, because `place_order` is what applies one
and a number computed on the phone would disagree with the receipt whenever a rule bit.
**An admin page for creating codes is still missing** — `coupons_admin` already allows
it, so that is a page and no migration.

Ratings, favourites and complaints are all plain table writes held up by policy alone,
which is the bet `verify:live` §7 exists to settle: a student rates the order they just
received, cannot rate it twice, cannot rate anyone else's, cannot read another student's
favourites or complaints, and cannot resolve their own complaint — while an admin can.
**59/59.**

It found one real defect on the first run. `addFavorite` used PostgREST's upsert, which
is `insert ... on conflict do update` and therefore asks for the UPDATE privilege;
`favorites` is granted `select, insert, delete` and no UPDATE, because the table is
nothing but its primary key and there is no column a repeat could change. The fix was a
plain insert that swallows 23505, not a wider grant.

**Funding is settled: the canteen absorbs every discount, including an admin-issued code**
(ADR 008). The platform's ₹2 of the delivery fee is never touched by a coupon. That was
already true of the maths, so nothing in `place_order` or `revenue_by_canteen_day`
changed — the analytics page simply stops calling it undecided.

## Phase 8 — production

Expo push (schema and content already exist from Phase 2), Razorpay verification function,
Sentry, EAS build profiles, Vercel deploy, CI running `npm run verify` plus SQL tests.

---

## Verified against a real Supabase

Phases 1–6 were built and tested entirely on PGlite. The stack has now run on a hosted
project: schema and seed pushed, accounts created, and `npm run verify:live` passing 34/34
— auth, realtime, the full student → canteen → partner → delivered path, and the RLS
boundaries, all through the anon key with real sign-ins.

Four defects surfaced that no offline suite could have caught, and the most important one
is a lesson about the harness rather than the schema: the PGlite shim was granting
`service_role` privileges that a real project never gives to tables created by a later
`db push`. The suite was green while every server-side call on a live project failed with 42501. A test harness that models a platform default generously is a harness that lies.
The grants are now stated explicitly in a migration, and the shim models reality.

### The admin UI, driven against live data

Every Phase 6 page was then walked in a browser against the hosted project — not only the
API layer beneath them. Orders search and filters, canteen edit and disable, counter staff
attach/detach (with the role flipping to `canteen` and back to `student`), delivery
onboard/transfer/retire/restore, account suspend/restore, hostel blocks, and the revenue
breakdown, at 375px and desktop.

Three things it confirmed that had only been argued on paper: `is_within_hours` marks
Night Canteen open at 00:05 IST while the rest read closed; a transfer keeps the retired
posting so a delivered order still resolves its partner through the composite foreign key;
and the campus date boundary excludes an order placed at 00:30 IST from the previous day,
which a UTC cutoff would not.

It also caught two defects: `seed-users.mjs` could only ever be run once, because
`place_order`'s idempotency returns the existing order and the script then replayed its
transitions; and the overview page still described Phase 6 as unbuilt. Both fixed, and the
seeder now proves itself by running twice in a row.
