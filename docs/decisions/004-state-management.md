# ADR 004 — TanStack Query for server state, Zustand for the cart

Status: **accepted** · 2026-09-19

## Decision

- **Server state** (canteens, menus, orders, notifications): TanStack Query.
- **Client state** (the cart, and role-independent UI preferences): Zustand, persisted.
- **Auth session**: a single React context wrapping supabase-js, which owns its own refresh.

No Redux. No global store of fetched data.

## Context

Almost everything on screen is a cached copy of a database row that another actor can
change at any moment. A canteen accepting an order must appear on the student's phone
without a refresh. The one genuinely client-owned piece of state is the cart, which must
survive an app restart.

## Alternatives considered

1. **Redux Toolkit + RTK Query.** Capable and familiar, but brings a store, slices and
   reducer boilerplate for data whose lifecycle is "fetch, cache, invalidate". The
   client-owned state here is one object.
2. **`useState` + `useEffect` fetching.** No dependency, but it means hand-rolling caching,
   deduplication, retry, refetch-on-focus and loading/error states in every screen —
   exactly the code that rots.
3. **Supabase Realtime writing into a global store.** Tempting, but it creates two paths
   for the same data (push vs fetch) that drift when the socket drops.

## Why this split

The rule is: **if the database owns it, TanStack Query owns it.** Realtime events do not
patch component state; they call `queryClient.invalidateQueries` on the matching key. One
code path produces rendered data, whether it was woken by a websocket or a screen focus. A
dropped socket degrades to normal refetching instead of showing a stale screen forever.

Query keys are centralised in one module (`src/api/keys.ts`) so a realtime handler and a
screen cannot disagree about a key.

The cart is genuinely local: it is not a database row until checkout, it must persist
across restarts, and it must never be trusted. The store holds item ids and quantities —
**never prices**, which are re-read server-side at order creation.

## Trade-offs

- Two state libraries instead of one. They have non-overlapping jobs and together weigh
  less than Redux Toolkit.
- Cache invalidation is now a thing to get right. Mitigated by centralised query keys and
  by invalidating broadly (a whole entity's keys) rather than surgically.
- Optimistic updates are used only for the canteen's accept/reject taps, where the latency
  is felt most. Everywhere else, waiting for the server is honest and simpler.

## Consequences

- `src/api/` holds typed query and mutation hooks. Screens never call `supabase` directly.
- `src/api/keys.ts` is the single key registry.
- The cart store validates against the live menu on entering checkout; a stale cart item
  surfaces as `ITEM_UNAVAILABLE` before submission rather than as a server rejection.
- The same TanStack Query setup is reused in the admin app, so data-fetching idioms are
  identical across mobile and web.
