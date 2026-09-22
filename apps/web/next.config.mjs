import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Worktree + parent lockfiles confuse tracing; pin to this app's package root.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Dev browser often uses 127.0.0.1 while Next binds localhost.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
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
