'use client'

import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import { clearStoredToken } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ArrowRight, Globe, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'

const AppShell = dynamic(() => import('@/components/app-shell'), { ssr: false })

export default function HomePage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  // v104: إن لم يكتمل فحص الجلسة خلال المهلة نعرض تنبيهاً مع زر إصلاح
  const [sessionHint, setSessionHint] = useState(false)
  const checkingRef = useRef(true)

  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)

  const isAr = language === 'ar'
  const isRtl = isAr

  // Check for existing session on mount
  useEffect(() => {
    // v104: علم الإقلاع — أول أثر ناجح لتنفيذ JS وتركيب React على الجهاز.
    // عامل اليقظة في layout يعتمد عليه فلا يظهر إصلاح التعطل للأجهزة السليمة.
    try { (window as any).__AXIS_BOOTED__ = true } catch {}
    var alive = true
    async function checkSession() {
      // v104: مهلة إلغاء 12 ثانية — بعض متصفحات الأجهزة القديمة (TLS/QUIC)
      // قد تعلّق fetch للأبد فلا يعمل .finally() وتبقى شاشة الانتظار عالقة.
      var ctrl: AbortController | null = null
      var timer: any = null
      try {
        if (typeof AbortController !== 'undefined') {
          ctrl = new AbortController()
          timer = setTimeout(function () { try { ctrl!.abort() } catch {} }, 12000)
        }
      } catch {}
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'include',
          cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined,
        })
        if (res.ok) {
          const data = await res.json().catch(function () { return null })
          if (data && data.user && alive) {
            setUser(data.user)
            return
          }
        }
      } catch {}
      if (timer) clearTimeout(timer)
      if (!alive) return
      clearStoredToken()
      setUser(null)
    }
    // v104: مؤقّت أمان الشاشة — لو لم يكتمل فحص الجلسة خلال 15 ثانية لأي سبب
    // (شبكة/جهاز) نُخرج المستخدم من الانتظار للأدمن/الدخول بدل التعليق الأبدي.
    var splashTimer = setTimeout(function () {
      if (!alive || !checkingRef.current) return
      setSessionHint(true)
      setChecking(false)
    }, 15000)
    checkSession().finally(function () {
      checkingRef.current = false
      if (!alive) return
      clearTimeout(splashTimer)
      setChecking(false)
    })
    return function () {
      alive = false
      clearTimeout(splashTimer)
    }
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

  // While checking session, show a branded splash (v95): كان الصفحة بيضاء فارغة
  // طوال فحص الجلسة — الآن شعار AXIS بنبض خفيف ودوّار بألوان النظام، هوية واحدة
  // وبلا أي نص لتفادي وميض تغيّر اللغة. لا منطق هنا — عرض فقط.
  if (checking) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-background gap-5">
        <img
          src="/axis-logo.png"
          alt="AXIS"
          className="h-16 w-auto object-contain animate-pulse select-none"
          draggable={false}
        />
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    )
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
      // v56: المنصة (Netlify) قد ترجع صفحة HTML عند تعطل الدالة أو مهلتها (502/504)
      // — res.json() يرمي عندها وتظهر رسالة «فشل الاتصال بالخادم» المضللة.
      // الآن نعرض رمز الحالة الفعلي والسبب المرجّح بدلاً منها.
      let data: any = null
      try {
        data = await res.json()
      } catch {}
      if (!data) {
        setError(isAr
          ? 'استجابة غير صالحة من الخادم (رمز ' + res.status + ') — غالباً انقطاع مؤقت أو توقف قاعدة البيانات. حاول بعد دقائق، وإن استمر افحص لوحة Supabase وحالة النشر في Netlify'
          : 'Invalid server response (HTTP ' + res.status + ') — likely a temporary outage or database down. Try again shortly')
        return
      }
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
      // v56: خطأ شبكة فعلي (انقطاع إنترنت/DNS) — رسالة أوضح من السابقة
      setError(isAr
        ? 'تعذر الوصول إلى الخادم — تحقق من اتصالك بالإنترنت أو حاول بعد قليل'
        : 'Cannot reach the server — check your internet connection or try later')
    } finally {
      setLoading(false)
    }
  }

  function toggleLanguage() { setLanguage(isAr ? 'en' : 'ar') }

  // v104: إصلاح ذاكرة التطبيق على الجهاز — يزيل التخزين القديم ويسجّل خروج
  // عامل الخدمة ويمسح الكاش ثم يعيد التحميل. آمن تماماً: لا توكنات في التخزين
  // (الجلسة كوكي httpOnly) فلا يفقد المستخدم أي بيانات مهمة.
  function repairAppStorage() {
    try { localStorage.removeItem('axis-storage') } catch {}
    try { sessionStorage.clear() } catch {}
    try {
      if ('caches' in window) {
        caches.keys().then(function (keys) {
          keys.forEach(function (k) { caches.delete(k).catch(function () {}) })
        }).catch(function () {})
      }
    } catch {}
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          regs.forEach(function (r) { r.unregister().catch(function () {}) })
        }).catch(function () {})
      }
    } catch {}
    toast.success(isAr ? 'جارٍ الإصلاح وإعادة التحميل...' : 'Repairing and reloading...')
    setTimeout(function () { window.location.reload() }, 800)
  }

  return (
    <div className="min-h-dvh flex flex-col lg:flex-row" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* قسم العلامة التعريفية: مختصر ومتماسك على الهاتف حتى لا يزيح النموذج تحت خط الطي */}
      <div className="lg:flex-1 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-6 sm:p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 rounded-full bg-white blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col items-center text-center">
          {/* الشعار مفرّغ (شفاف) — يظهر مباشرة دون صندوق وبحجم أكبر */}
          <img
            src="/logo-white.png"
            alt="AXIS"
            className="h-20 sm:h-28 lg:h-32 w-auto object-contain drop-shadow-lg mb-3 lg:mb-4"
          />
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-wide">AXIS</h1>
          <p className="text-xs sm:text-sm text-primary-foreground/70 font-light tracking-wider">Pipe Jacking &amp; Microtunneling</p>
        </div>
        <div className="relative z-10 space-y-4 lg:space-y-6 pt-4 lg:pt-0">
          <h2 className="text-xl sm:text-2xl lg:text-4xl font-bold leading-snug lg:leading-tight">{t.heroTitle}</h2>
        </div>
        <div className="relative z-10 text-xs lg:text-sm text-primary-foreground/70 pt-3 lg:pt-0">{t.copyright}</div>
      </div>
      {/* نموذج الدخول: مساحة مريحة على الهاتف + احترام المساحات الآمنة أعلى/أسفل */}
      <div className="lg:flex-1 flex items-center justify-center px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-16 lg:py-16 bg-background">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-6 lg:mb-8">
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
                className="h-12 lg:h-11"
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
                className="h-12 lg:h-11"
                dir="ltr"
                autoComplete="new-password"
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {/* v104: تنبيه فشل فحص الجلسة + زر إصلاح ذاكرة الجهاز */}
            {sessionHint && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-800">
                <AlertDescription className="space-y-2">
                  <span>
                    {isAr
                      ? 'تعذّر التحقق من الجلسة على هذا الجهاز — تحقق من الاتصال أو حدّث الصفحة. إن تكررت المشكلة فالذاكرة المؤقتة للجهاز قد تكون عالقة:'
                      : 'Could not verify the session on this device — check connection or refresh. If it persists, the device cache may be stuck:'}
                  </span>
                  <Button type="button" variant="outline" size="sm" className="w-full" onClick={repairAppStorage}>
                    <Wrench className="h-4 w-4 ml-2" />
                    {isAr ? 'إصلاح ذاكرة التطبيق وإعادة التحميل' : 'Repair app storage & reload'}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={loading} className="w-full h-12 lg:h-11 text-[15px] lg:text-base" size="lg">
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
