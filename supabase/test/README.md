# Database tests

These run the real files in `supabase/migrations/` against an in-process Postgres
([PGlite](https://pglite.dev)), so the SQL is executed rather than merely written. No
Docker, no `supabase start`, no local Postgres.

```bash
npm test                      # everything
npx vitest run supabase/test  # just these
```

`harness.ts` provides a minimal stand-in for the parts of Supabase's `auth` schema the
migrations touch (`auth.users`, `auth.uid()`, the `authenticated` role), then applies every
migration in timestamp order. `db.asUser(id)` switches to `authenticated` with that user's
subject claim, which is how RLS sees a signed-in client.

## What these tests do and do not prove

| Verified here                                               | Not verified here                                 |
| ----------------------------------------------------------- | ------------------------------------------------- |
| Migrations apply cleanly, in order                          | Supabase Auth, Realtime, Storage behaviour        |
| Every table has RLS on and at least one policy              | The `supabase_realtime` publication               |
| RLS isolation between students, canteens, partners, admins  | Actual JWT verification (claims are set directly) |
| Column grants (no client can write `role` or `is_approved`) | Performance under a real query planner            |
| Order totals, snapshots, coupon maths                       |                                                   |
| Every state transition and who may trigger it               |                                                   |
| The guard that decides a race, and the error the loser gets | **Two transactions running in parallel**          |

**The concurrency caveat is the important one.** PGlite is single-connection, so these
tests drive the race sequentially: partner A claims, then partner B is refused. That checks
the guard exists (`where status = 'ready' and delivery_partner_id is null`) and that losing
raises `DELIVERY_ALREADY_CLAIMED` — but the atomicity itself comes from Postgres, and
proving it under genuine parallelism needs a real server.

To do that, run the same scenarios against `supabase start` with two connections. Until
someone has Docker on this machine, the sequential check plus the `unique` constraint and
the conditional `UPDATE` are what stands between us and a double-claimed order.

## Test data

`seedCampus()` loads the real `supabase/seed.sql`, then creates a standard cast (two
students, two canteens' staff, two partners, an admin). It forces every canteen to
always-open, because the seeded hours are real and a test that only passes between 08:00
and 22:00 IST is a test that fails at night.
