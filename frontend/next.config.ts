import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/ws/:path*',
        destination: 'http://127.0.0.1:8000/ws/:path*',
      },
      {
        source: '/generate_epcr',
        destination: 'http://127.0.0.1:8000/generate_epcr',
      }
    ];
  },
};

export default nextConfig;
