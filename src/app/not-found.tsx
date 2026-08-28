'use client'

import { useEffect } from 'react'

export default function NotFound() {
  useEffect(() => {
    window.location.replace('/')
  }, [])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', background: '#f9fafb', color: '#6b7280',
    }}>
      <p>...</p>
    </div>
  )
}
