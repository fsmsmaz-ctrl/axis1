import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // M-1 FIX: Do not ignore TypeScript errors in production
  typescript: {
    ignoreBuildErrors: false,
  },
}

export default nextConfig
