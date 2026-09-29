/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship TypeScript source rather than a build output, so
  // Next has to compile them like first-party code.
  transpilePackages: ['@canteza/shared', '@canteza/api'],
  reactStrictMode: true,
  // `next build` type-checks the app without test/. The tests import vitest, a root
  // devDependency that Vercel does not install when it installs this workspace alone;
  // they are still type-checked by `npm run typecheck` (tsconfig.json) in verify and CI.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
};

export default nextConfig;
