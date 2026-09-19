import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'apps/**/test/**/*.test.ts',
      'supabase/test/**/*.test.ts',
    ],
    testTimeout: 30_000,
    // Each supabase suite builds a whole Postgres from the migrations in beforeAll.
    // Vitest's default hookTimeout is 10s, and under load (six PGlite instances at
    // once) that is exceeded -- which surfaces as a suite that "failed" with every
    // test skipped, rather than as a slow test. Not a guess: a run that reported
    // this had transitions.test.ts at 11.1s.
    hookTimeout: 120_000,
  },
});
