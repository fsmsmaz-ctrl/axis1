'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  return (
    <html lang="ar" dir="rtl">
      <body style={{
        margin: 0,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#f9fafb',
        color: '#111827',
      }}>
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '400px' }}>
          <div style={{
            width: '64px', height: '64px',
            borderRadius: '50%', background: '#fef2f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1.5rem', fontSize: '2rem',
          }}>
            !
          </div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            حدث خطأ غير متوقع
          </h1>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            يرجى المحاولة مرة أخرى
          </p>
          <button
            onClick={() => window.location.href = '/'}
            style={{
              padding: '0.625rem 1.5rem',
              background: '#2563eb', color: '#fff', border: 'none',
              borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            العودة للرئيسية
          </button>
        </div>
      </body>
    </html>
  )
}
