/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship TypeScript source rather than a build output, so
  // Next has to compile them like first-party code.
  transpilePackages: ['@canteza/shared', '@canteza/api'],
  reactStrictMode: true,
};

export default nextConfig;
