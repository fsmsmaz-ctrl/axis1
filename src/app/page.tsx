'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { clearStoredToken } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ArrowRight, Globe } from 'lucide-react'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'

const AppShell = dynamic(() => import('@/components/app-shell'), { ssr: false })

export default function HomePage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)

  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)

  const isAr = language === 'ar'
  const isRtl = isAr

  // Check for existing session on mount
  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          if (data.user) {
            setUser(data.user)
            return
          }
        }
      } catch {}
      // Clear stale data if session is invalid
      clearStoredToken()
      setUser(null)
      setChecking(false)
    }
    checkSession()
  }, [setUser])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language
      document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
    }
  }, [language, isRtl])

  // If user is logged in, show the app
  if (user) {
    return <AppShell />
  }

  // While checking session, show nothing (prevents flash of login form)
  if (checking) {
    return null
  }

  const t = {
    loginTitle: isAr ? 'تسجيل الدخول' : 'Login',
    loginSubtitle: isAr ? 'أدخل بياناتك للمتابعة' : 'Enter your credentials to continue',
    email: isAr ? 'اسم المستخدم' : 'Username',
    password: isAr ? 'كلمة المرور' : 'Password',
    signIn: isAr ? 'دخول' : 'Sign In',
    invalidCreds: isAr ? 'بيانات الدخول غير صحيحة' : 'Invalid credentials',
    connectionError: isAr ? 'فشل الاتصال بالخادم' : 'Connection failed',
    welcomeBack: isAr ? 'مرحباً بعودتك، ' : 'Welcome back, ',
    heroTitle: isAr ? 'نظام إدارة عمليات الحفر الاحترافي' : 'Professional Pipe Jacking Management System',
    copyright: isAr ? '© 2026 AXIS - جميع الحقوق محفوظة' : '© 2026 AXIS - All rights reserved',
    langBtn: isAr ? 'EN' : 'ع',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'invalidCredentials') {
          setError(isAr ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Invalid email or password')
        } else if (data.error === 'database_error' || data.error === 'init_failed') {
          setError(isAr ? 'خطأ في قاعدة البيانات: ' + (data.message || 'يرجى تهيئة قاعدة البيانات') : 'Database error: ' + (data.message || 'Please initialize database'))
        } else if (data.error === 'internal_error') {
          setError(isAr ? 'خطأ داخلي: ' + (data.message || 'يرجى المحاولة مرة أخرى') : 'Internal error: ' + (data.message || 'Please try again'))
        } else {
          setError(data.message || t.invalidCreds)
        }
        return
      }
      // FIX: Removed dead code — token is in httpOnly cookie, not in response body
      setLanguage(data.user.language === 'en' ? 'en' : 'ar')
      await new Promise(resolve => setTimeout(resolve, 100))
      setUser(data.user)
      toast.success(t.welcomeBack + data.user.name)
    } catch (err) {
      setError(t.connectionError)
    } finally {
      setLoading(false)
    }
  }

  function toggleLanguage() { setLanguage(isAr ? 'en' : 'ar') }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="lg:flex-1 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 rounded-full bg-white blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-3 mb-3">
            <img
              src="/logo-white.png"
              alt="AXIS"
              className="h-24 w-auto object-contain"
            />
          </div>
          <h1 className="text-4xl font-bold tracking-wide">AXIS</h1>
          <p className="text-sm text-primary-foreground/70 font-light tracking-wider">Pipe Jacking &amp; Microtunneling</p>
        </div>
        <div className="relative z-10 space-y-6">
          <h2 className="text-3xl lg:text-4xl font-bold leading-tight">{t.heroTitle}</h2>
        </div>
        <div className="relative z-10 text-sm text-primary-foreground/70">{t.copyright}</div>
      </div>
      <div className="lg:flex-1 flex items-center justify-center p-6 lg:p-16 bg-background">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold">{t.loginTitle}</h2>
              <p className="text-muted-foreground text-sm mt-1">{t.loginSubtitle}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={toggleLanguage} className="gap-1.5">
              <Globe className="h-4 w-4" />
              <span className="text-sm font-semibold">{t.langBtn}</span>
            </Button>
          </div>
          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isAr ? 'اسم المستخدم' : 'Username'}
                required
                className="h-11"
                dir="ltr"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t.password}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isAr ? 'كلمة المرور' : 'Password'}
                required
                className="h-11"
                dir="ltr"
                autoComplete="new-password"
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={loading} className="w-full h-11" size="lg">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>{t.signIn}<ArrowRight className={`h-4 w-4 ${isRtl ? 'mr-2 rotate-180' : 'ml-2'}`} /></>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
