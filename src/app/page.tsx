'use client'

import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import LoginPage from '@/components/auth/login-page'
import AppShell from '@/components/app-shell'
import { Loader2, Database, AlertTriangle, CheckCircle2, Terminal } from 'lucide-react'
import { clearStoredToken, authedFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function Home() {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const [loading, setLoading] = useState(true)
  const [needsInit, setNeedsInit] = useState(false)
  const [initing, setIniting] = useState(false)
  const [initResult, setInitResult] = useState<any>(null)
  const hasCheckedSession = useRef(false)

  useEffect(() => {
    if (hasCheckedSession.current) return
    hasCheckedSession.current = true

    async function checkSession() {
      try {
        const res = await authedFetch('/api/auth/me')
        const data = await res.json()
        if (data.user) {
          setUser(data.user)
          setLanguage(data.user.language === 'en' ? 'en' : 'ar')
        } else {
          setUser(null)
          clearStoredToken()
        }
      } catch {
        // Network error
      } finally {
        setLoading(false)
      }
    }
    checkSession()
  }, [setUser, setLanguage])

  // Check if database needs initialization - only once per session
  useEffect(() => {
    async function checkInit() {
      try {
        const initChecked = sessionStorage.getItem('axis_init_checked')
        if (initChecked === 'true') return
      } catch {
        // sessionStorage not available
      }

      try {
        const res = await fetch('/api/init')
        const data = await res.json()
        if (data.needsInit) {
          setNeedsInit(true)
        } else {
          try { sessionStorage.setItem('axis_init_checked', 'true') } catch {}
        }
      } catch {
        // ignore - will show login page
      }
    }
    checkInit()
  }, [])

  async function handleInit() {
    setIniting(true)
    setInitResult(null)
    try {
      const res = await fetch('/api/init', { method: 'POST' })
      const data = await res.json()
      setInitResult(data)
      if (data.initialized) {
        setNeedsInit(false)
        try { sessionStorage.setItem('axis_init_checked', 'true') } catch {}
        setTimeout(() => window.location.reload(), 2500)
      }
    } catch (error) {
      setInitResult({ error: 'Network error: ' + String(error) })
    } finally {
      setInit
