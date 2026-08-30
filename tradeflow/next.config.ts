import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The PDF builder and the Anthropic SDK are server-only; keep them out of
  // any client bundle even if a shared module accidentally re-exports them.
  serverExternalPackages: ['pdf-lib', '@anthropic-ai/sdk'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), geolocation=(self), microphone=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
