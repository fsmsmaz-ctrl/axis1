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
      setIniting(false)
    }
  }

  // If user is logged in, ALWAYS show AppShell (this is the key navigation logic)
  if (user) {
    return <AppShell />
  }

  // Show loader on initial load only
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  // Show initialization screen if database is empty (only when no user)
  if (needsInit) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4" dir="rtl">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              تهيئة قاعدة البيانات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                قاعدة البيانات فارغة أو غير مُهيأة. يجب تهيئتها بإنشاء المستخدمين الافتراضيين قبل تسجيل الدخول.
              </AlertDescription>
            </Alert>

            <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
              <p className="font-medium">سيتم إنشاء الحسابات التالية:</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>• admin@axis.om (مدير النظام)</li>
                <li>• ceo@axis.om (الإدارة العليا)</li>
                <li>• pm@axis.om (مدير المشروع)</li>
                <li>• engineer@axis.om (مهندس الموقع)</li>
                <li>• hse@axis.om (مسؤول السلامة)</li>
                <li>• foreman@axis.om (المشرف)</li>
                <li>• finance@axis.om (المحاسب)</li>
              </ul>
              <p className="font-medium pt-2 border-t text-muted-foreground text-xs">
                كلمة المرور محددة من متغير البيئة INIT_ADMIN_PASSWORD
              </p>
            </div>

            {initResult && (
              <Alert variant={initResult.initialized ? 'default' : 'destructive'}>
                {initResult.initialized ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                <AlertDescription className="space-y-2">
                  <p>
                    {initResult.initialized
                      ? `تم إنشاء ${initResult.userCount} مستخدم بنجاح! جاري إعادة التحميل...`
                      : initResult.error || 'فشل في التهيئة'}
                  </p>
                  {initResult.details && (
                    <div className="bg-background/50 p-2 rounded text-xs font-mono mt-2 max-h-32 overflow-y-auto">
                      <div className="flex items-start gap-1.5">
                        <Terminal className="h-3 w-3 mt-0.5 shrink-0" />
                        <pre className="whitespace-pre-wrap break-all">{initResult.details}</pre>
                      </div>
                    </div>
                  )}
                  {initResult.hint && (
                    <p className="text-xs italic">{initResult.hint}</p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Button
              onClick={handleInit}
              disabled={initing || initResult?.initialized}
              className="w-full"
              size="lg"
            >
              {initing ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  جاري التهيئة...
                </>
              ) : (
                <>
                  <Database className="h-4 w-4 ml-2" />
                  تهيئة قاعدة البيانات الآن
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              إذا استمر الفشل، تأكد من أن مجلد قاعدة البيانات قابل للكتابة
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // If no user, show login
  return <LoginPage />
}
