/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@speedora/shared'],
  // Traces the minimal set of files/deps a production server actually needs
  // into .next/standalone, instead of shipping the whole node_modules tree -
  // see apps/web/Dockerfile, which sets DOCKER_BUILD=1 before running
  // `next build`. Conditional rather than always-on because standalone
  // output recreates pnpm's symlinked node_modules structure, which needs
  // either an elevated process or Windows Developer Mode (and a fresh
  // logon/session for that setting to actually take effect) - a plain local
  // `pnpm build` shouldn't require either just to typecheck/verify the app
  // still builds.
  ...(process.env.DOCKER_BUILD === '1' ? { output: 'standalone' } : {}),
};

export default nextConfig;
