# CampusEats — Implementation roadmap

Vertical slices. Each phase ends with something demonstrable end-to-end, not a set of
half-built screens.

| Phase | Outcome                                                                          | Status  |
| ----- | -------------------------------------------------------------------------------- | ------- |
| 0     | Repository assessment, architecture, ADRs                                        | ✅ done |
| 1     | Monorepo, tooling, shared domain core (state machine, pricing, rules) + tests    | ✅ done |
| 2     | Database schema, RLS, RPC functions, seed data                                   | ✅ done |
| 3     | Auth + role routing (mobile shell, admin shell)                                  | ⬜ next |
| 4     | **Core slice:** browse → cart → checkout → order → canteen accepts → live status | ⬜      |
| 5     | Delivery partner: pool, claim, pickup, deliver, earnings                         | ⬜      |
| 6     | Admin dashboard: overview, orders, users, canteens, hostels                      | ⬜      |
| 7     | Secondary: ratings, favourites, reorder, coupons, complaints, analytics          | ⬜      |
| 8     | Push notifications, Razorpay, Sentry, EAS/Vercel deploy                          | ⬜      |

---

## Phase 1 — foundation ✅

Monorepo (npm workspaces), TypeScript strict, ESLint flat config, Prettier, Vitest.
`packages/shared` holds the domain core: `money`, `order-status`, `pricing`, `rules`,
`payment`, `errors`, `notifications`, `brand`, `config`. 33 tests, all green.

Nothing UI-shaped was built here on purpose: every screen in later phases depends on these
rules, and they are the part that must be right.

## Phase 2 — database ✅

Three migrations plus seed data, all executed by 65 tests running on in-process Postgres
(ADR 007 — no Docker needed).

- `..._schema.sql` — 19 tables, indexes, the `canteens_public` view, and
  `order_transitions`: the state machine stored as data so a test can diff it against
  `packages/shared`.
- `..._rls.sql` — helpers (`auth_role`, `is_admin`, `my_canteen_id`,
  `is_delivery_partner`), RLS on every table, grants that withhold `profiles.role` and
  `delivery_partners.is_approved` at the column level, and the `delivery_pool` view.
- `..._functions.sql` — `place_order`, `transition_order`, `claim_delivery`,
  `release_delivery`, `notify_order`.
- `seed.sql` — four canteens, 28 menu items, four hostels, three coupons.
- `seed-users.mjs` — accounts via the Auth API, then demo orders placed through the real
  RPCs over HTTP.

Exit criteria met: a student cannot read another student's order; a repeated idempotency
key yields one order; a second claim on a taken delivery raises
`DELIVERY_ALREADY_CLAIMED`. The one gap is genuine parallelism — see ADR 007.

## Phase 3 — auth + shells

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

Open pool of `ready` orders, atomic claim, pickup, deliver, daily history and earnings.
Completes the end-to-end flow.

## Phase 6 — admin

Overview metrics, order search/filter, user and canteen management, hostel management.

## Phase 7 — secondary features

Ratings, favourites, reorder, coupons, support tickets, analytics charts.

## Phase 8 — production

Expo push (schema and content already exist from Phase 2), Razorpay verification function,
Sentry, EAS build profiles, Vercel deploy, CI running `npm run verify` plus SQL tests.
