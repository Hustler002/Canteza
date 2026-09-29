/**
 * Response headers for every page.
 *
 * The dashboard's forms change who is an admin, which canteen is open and who is
 * suspended, so it must never render inside someone else's page: a framed dashboard is a
 * clickjacking target, where a visitor to another site is tricked into pressing a button
 * they cannot see. `frame-ancestors 'none'` is the modern refusal and `X-Frame-Options`
 * the one older browsers read.
 *
 * The CSP stops there on purpose. A script-src policy for Next needs a nonce on every
 * inline script it emits, which forces every page to render dynamically; what is here
 * costs nothing and closes the attacks a dashboard with no user-supplied HTML is exposed
 * to. `form-action 'self'` keeps every server action posting back to this origin.
 */
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship TypeScript source rather than a build output, so
  // Next has to compile them like first-party code.
  transpilePackages: ['@canteza/shared', '@canteza/api'],
  reactStrictMode: true,
  // No `X-Powered-By: Next.js`: it tells a scanner which exploits to try first.
  poweredByHeader: false,
  // `next build` type-checks the app without test/. The tests import vitest, a root
  // devDependency that Vercel does not install when it installs this workspace alone;
  // they are still type-checked by `npm run typecheck` (tsconfig.json) in verify and CI.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
