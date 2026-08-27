"use client"
import { useState, useEffect } from 'react'
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(max-width: 768px)')
    setIsMobile(m.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    m.addEventListener('change', handler)
    return () => m.removeEventListener('change', handler)
  }, [])
  return isMobile
}
