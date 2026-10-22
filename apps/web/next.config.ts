import path from 'node:path';
import type { NextConfig } from 'next';
import { staticRedirects } from './lib/redirects';

const nextConfig: NextConfig = {
  // Lets `next dev` and `next build` run side by side without sharing a
  // build directory (NEXT_DIST_DIR=.next-dev for the dev server).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Worktree + parent lockfiles confuse tracing; pin to this app's package root.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Dev browser often uses 127.0.0.1 while Next binds localhost.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async redirects() {
    return staticRedirects();
  },
  async headers() {
    // The careers-page snippet keeps one URL forever: browsers recheck it hourly (ETag), the
    // CDN keeps it until the next deploy.
    return [
      {
        source: '/embed.js',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400' }],
      },
    ];
  },
  async rewrites() {
    // Same-origin API access in development, so the session cookie is
    // first-party and SameSite=Lax works without cross-origin complexity.
    const api = process.env.API_URL ?? 'http://localhost:3001';
    return [
      // Auth only — leave /api/health for the Next route (compose liveness).
      { source: '/api/auth/:path*', destination: `${api}/api/auth/:path*` },
      { source: '/backend/:path*', destination: `${api}/:path*` },
    ];
  },
};

export default nextConfig;
