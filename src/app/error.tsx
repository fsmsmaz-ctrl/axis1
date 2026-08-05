'use client'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: '1.5rem',
        textAlign: 'center',
        direction: 'rtl',
        fontFamily: 'var(--font-cairo), var(--font-tajawal), sans-serif',
      }}
    >
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
        حدث خطأ غير متوقع
      </h2>
      <p style={{ color: '#666', marginBottom: '1.5rem', maxWidth: '400px' }}>
        يرجى الضغط على الزر أدناه لإعادة تحميل الصفحة. إذا استمرت المشكلة، تواصل مع المسؤول.
      </p>
      <button
        onClick={reset}
        style={{
          padding: '0.625rem 1.5rem',
          borderRadius: '0.5rem',
          backgroundColor: '#2563eb',
          color: 'white',
          border: 'none',
          fontSize: '1rem',
          fontWeight: '600',
          cursor: 'pointer',
        }}
      >
        إعادة التحميل
      </button>
    </div>
  )
}
