'use client'

import Image from 'next/image'
import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { saveStoredToken } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ArrowRight, Globe } from 'lucide-react'
import { toast } from 'sonner'

const AXIS_LOGO_WHITE = 'data:image/png;base64,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'

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
      <div className="lg:flex-1 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 rounded-full bg-white blur-3xl" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <Image src={AXIS_LOGO_WHITE} alt="AXIS" width={56} height={56} unoptimized className="h-14 w-auto object-contain drop-shadow-lg" />
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@axis.om" required className="h-11" dir="ltr" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t.password}</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="h-11" dir="ltr" />
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
