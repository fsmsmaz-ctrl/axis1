'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { saveStoredToken } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ArrowRight, Globe } from 'lucide-react'
import { toast } from 'sonner'

const features = [
  { ar: 'لوحة تحكم مباشرة', en: 'Live Dashboard', icon: '📊' },
  { ar: 'تقارير PDF و Excel', en: 'PDF & Excel Reports', icon: '📄' },
  { ar: 'إدارة السلامة', en: 'Safety Management', icon: '🦺' },
  { ar: 'حساب الإيرادات تلقائياً', en: 'Auto Revenue Calc', icon: '💰' },
  { ar: 'إدارة المعدات', en: 'Equipment Mgmt', icon: '⚙️' },
  { ar: 'دعم الموبايل', en: 'Mobile Support', icon: '📱' },
]

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const setUser = useAppStore((s) => s.setUser)
  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)

  const isAr = language === 'ar'
  const isRtl = isAr

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language
      document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
    }
  }, [language, isRtl])

  const t = {
    loginTitle: isAr ? 'تسجيل الدخول' : 'Login',
    loginSubtitle: isAr ? 'أدخل بياناتك للمتابعة' : 'Enter your credentials to continue',
    email: isAr ? 'البريد الإلكتروني' : 'Email',
    password: isAr ? 'كلمة المرور' : 'Password',
    signIn: isAr ? 'دخول' : 'Sign In',
    invalidCreds: isAr ? 'بيانات الدخول غير صحيحة' : 'Invalid credentials',
    connectionError: isAr ? 'فشل الاتصال بالخادم' : 'Connection failed',
    welcomeBack: isAr ? 'مرحباً بعودتك، ' : 'Welcome back, ',
    heroTitle: isAr ? 'نظام إدارة عمليات الحفر الاحترافي' : 'Professional Pipe Jacking Management System',
    heroDesc: isAr
      ? 'منصة متكاملة لإدارة مشاريع Pipe Jacking / Microtunneling - متابعة الإنتاج اليومي، السلامة، المعدات، التكاليف والإيرادات، وتقارير الأداء من خلال لوحة تحكم مباشرة.'
      : 'Integrated platform for managing Pipe Jacking / Microtunneling projects - daily production tracking, safety, equipment, costs & revenue, and performance reports through a live dashboard.',
    copyright: isAr ? '© 2025 AXIS - جميع الحقوق محفوظة' : '© 2025 AXIS - All rights reserved',
    langBtn: isAr ? 'EN' : 'ع',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
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

      if (data.token) {
        saveStoredToken(data.token)
      }

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

  function toggleLanguage() {
    setLanguage(isAr ? 'en' : 'ar')
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Right side - Hero */}
      <div className="lg:flex-1 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 rounded-full bg-white blur-3xl" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <img
              src="/logo.png"
              alt="AXIS Logo"
              className="h-12 w-auto object-contain"
            />
            <div>
              <h1 className="text-3xl font-bold">AXIS</h1>
              <p className="text-sm text-primary-foreground/80">Pipe Jacking & Microtunneling</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-3xl lg:text-4xl font-bold leading-tight">
            {t.heroTitle}
          </h2>
          <p className="text-lg text-primary-foreground/90 leading-relaxed">
            {t.heroDesc}
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {features.map((item) => (
              <div key={item.en} className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-lg px-3 py-2">
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm">{isAr ? item.ar : item.en}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-sm text-primary-foreground/70">
          {t.copyright}
        </div>
      </div>

      {/* Left side - Login form */}
      <div className="lg:flex-1 flex items-center justify-center p-6 lg:p-16 bg-background">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold">{t.loginTitle}</h2>
              <p className="text-muted-foreground text-sm mt-1">{t.loginSubtitle}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguage}
              className="gap-1.5"
            >
              <Globe className="h-4 w-4" />
              <span className="text-sm font-semibold">{t.langBtn}</span>
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@axis.om"
                required
                className="h-11"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t.password}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="h-11"
                dir="ltr"
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
                <>
                  {t.signIn}
                  <ArrowRight className={`h-4 w-4 ${isRtl ? 'mr-2 rotate-180' : 'ml-2'}`} />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
