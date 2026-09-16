/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
    ],
  },
  async rewrites() {
    // Same-origin API access in development, so the session cookie is
    // first-party and SameSite=Lax works without cross-origin complexity.
    const api = process.env.API_URL ?? 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/backend/:path*', destination: `${api}/:path*` },
    ];
  },
};

export default nextConfig;
