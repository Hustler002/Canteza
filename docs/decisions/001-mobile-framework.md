# ADR 001 — Expo (React Native) for a single mobile codebase

Status: **accepted** · 2026-09-19

## Decision

One Expo app (React Native, TypeScript, `expo-router`) serving all three mobile roles.
The authenticated user's role selects which route group mounts.

## Context

Three distinct mobile experiences are needed — student, canteen, delivery — but they share
authentication, order data, the order state machine, the design system and realtime
plumbing. A one-campus MVP has one developer, one release train, and Android-first users.

## Alternatives considered

1. **Three separate Expo apps.** Clean isolation, but three builds, three store listings,
   three dependency upgrades, and three copies of the auth/realtime layer. The canteen and
   delivery apps would be ~8 screens each — not enough to justify the triplication.
2. **Flutter.** Excellent UI performance, but the shared domain package is TypeScript and
   the admin dashboard is TypeScript. Flutter would mean reimplementing the order state
   machine and pricing in Dart — exactly the duplication that causes divergence bugs.
3. **PWA for all roles.** Cheapest to ship, but push notifications on iOS are unreliable
   and a canteen must be woken by a new order. Rejected on the core requirement.

## Why Expo

- One codebase, one language, one shared domain package with the admin app.
- `expo-router` gives file-based routing with route groups, which maps cleanly onto
  role-scoped navigation trees (`(student)`, `(canteen)`, `(delivery)`).
- EAS Build produces an installable APK without a local Android toolchain — relevant, since
  development is on Windows.
- OTA updates: a pricing-rule fix reaches canteen phones in minutes, not a store review.
- Expo Notifications is the shortest path to push when Phase 6 arrives.

## Trade-offs

- Single app bundle ships all three roles' code to every user. At this app's size the
  bundle cost is small; if it ever matters, the role groups are already the natural split
  point for separate builds.
- Expo SDK upgrades are an occasional coordinated chore.
- Deep native work (custom Bluetooth printers for canteens, say) needs a dev build. Not an
  MVP requirement.

## Consequences

- Role-specific code lives under `app/(student)`, `app/(canteen)`, `app/(delivery)`.
- Anything shared by two roles moves to `src/` (components, hooks, api) — not copy-pasted.
- Route groups are guarded by a layout that reads the role from the verified JWT. This is
  UX, not security; the database enforces the same boundary independently.
