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
        minHeight: '100vh',
        padding: '1.5rem',
        textAlign: 'center',
        direction: 'rtl',
        fontFamily: 'var(--font-cairo), var(--font-tajawal), sans-serif',
      }}
    >
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>&#9888;&#65039;</div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
        حدث خطأ غير متوقع
      </h2>
      <p style={{ color: '#dc2626', marginBottom: '0.5rem', maxWidth: '500px', fontSize: '0.8rem', wordBreak: 'break-word', background: '#fef2f2', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #fecaca' }}>
        {error.message || 'Unknown error'}
      </p>
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
