import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // M-1 FIX: Do not ignore TypeScript errors in production
  typescript: {
    ignoreBuildErrors: false,
  },
  // SECURITY FIX: صفحات HTML كانت بلا CSP (كانت تُطبق على استجابات API فقط بلا فائدة)
  // CSP أساس الحماية من XSS — الاستثناءات المطلوبة لتشغيل Next.js (bootstrap scripts)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
