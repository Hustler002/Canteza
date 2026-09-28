import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.expo/**', '**/.next/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Node scripts: a CLI seeder or generator is allowed to talk to the terminal.
    files: ['supabase/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
  {
    // Supabase Edge Function entrypoints run on **Deno**, not Node: they import from
    // `jsr:` and `https:` specifiers and use the `Deno` global, none of which the
    // TypeScript resolver here can see. Linting them would report a wall of phantom
    // errors about a runtime this config knows nothing about.
    //
    // Only the entrypoints. `functions/_shared/**` is deliberately *not* ignored —
    // it is plain Web Crypto TypeScript that runs in both runtimes, it is imported by
    // `supabase/test/razorpay-signature.test.ts`, and it is the file guarding the
    // money, so it gets the same linting and typechecking as everything else.
    ignores: ['supabase/functions/*/index.ts'],
  },
  {
    // CommonJS build config that Metro, Babel and Expo load directly, not through the
    // bundler. app.config.js also reads process.env: it runs at build time, in Node.
    files: ['apps/*/metro.config.js', 'apps/*/babel.config.js', 'apps/*/app.config.js'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
