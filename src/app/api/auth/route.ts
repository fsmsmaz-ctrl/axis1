// Login endpoint (POST /api/auth)
// C-6 FIX: No token in response body — relies on httpOnly cookie only
// M-6 FIX: Minimum password length 6 (unified with all other routes)
// C-3 FIX: No default passwords

import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials, createSession, getCookieOptions, SESSION_COOKIE } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
// v50: الشفاء الذاتي على مسار الدخول — انظر الاستدعاء قبل verifyCredentials
import { ensurePurchasesSupport, ensureHRSupport, ensureMediaSupport } from '@/lib/db-selfheal'
// v52: إنشاء حساب الزائر تلقائياً عند أول محاولة دخول (قبل verifyCredentials)
import { ensureVisitorAccount } from '@/lib/db-selfheal'

// v56: مهلة قصوى لكل خطوة قاعدة بيانات في الدخول — لو علق الاتصال (مثل مشروع
// Supabase المتوقف paused أو بطء الشبكة) نرجع رسالة JSON واضحة تحدد السبب،
// بدل مهلة Netlify (10 ثوانٍ → 504 HTML) التي تصل للواجهة رداً غير JSON
// فتظهر للمستخدم رسالة «فشل الاتصال بالخادم» المضللة بلا أي تفاصيل.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>(function (_resolve, reject) {
      setTimeout(function () { reject(new Error('AXIS_TIMEOUT_' + label)) }, ms)
    }),
  ])
}

function isTimeoutErr(e: unknown): boolean {
  return !!e && String((e as { message?: string }).message || '').indexOf('AXIS_TIMEOUT_') === 0
}

export async function POST(req: NextRequest) {
  var rl = checkRateLimit(req, RateLimitPresets.auth)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'محاولات تسجيل دخول كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var body = await req.json()
    var email = body.email
    var password = body.password

    if (!email || !password) {
      return NextResponse.json(
        { error: 'missing_fields', message: 'البريد الإلكتروني وكلمة المرور مطلوبان' },
        { status: 400 }
      )
    }

    var emailStr = String(email).toLowerCase().trim()
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailStr)) {
      return NextResponse.json(
        { error: 'invalid_input', message: 'صيغة البريد الإلكتروني غير صحيحة' },
        { status: 400 }
      )
    }

    // FIX-3.1: Unified minimum 6 characters (was 4, inconsistent with user creation routes)
    if (String(password).length < 6) {
      return NextResponse.json(
        { error: 'missing_fields', message: 'كلمة المرور قصيرة جداً (6 أحرف على الأقل)' },
        { status: 400 }
      )
    }

    // v56: فحص قاعدة البيانات بمهلة 3.5 ثوانٍ — التعليق يعطي رسالة صريحة فورية
    try {
      await withTimeout(db.$queryRaw`SELECT 1`, 3500, 'DB_PING')
    } catch (dbErr) {
      console.error('Database connection failed during login:', dbErr)
      return NextResponse.json(
        {
          error: 'database_error',
          message: isTimeoutErr(dbErr)
            ? 'قاعدة البيانات لا تستجيب (تجاوزت المهلة). افتح لوحة Supabase وتحقق من أن المشروع نشط — المشاريع المجانية تتوقف تلقائياً بعد أسبوع من عدم الاستخدام، اضغط Resume لاستئنافها.'
            : 'فشل الاتصال بقاعدة البيانات. يرجى المحاولة لاحقاً.',
        },
        { status: 503 }
      )
    }

    // v50: شفاء ذاتي قبل التحقق من بيانات الدخول — أعمدة/جداول v48 (points/Purchase)
    // قد لا تكون مطبقة لأن Netlify لا يشغّل prisma migrate deploy (درس v44)،
    // وfindUnique يقرأ كل أعمدة النموذج فيفشل الدخول بـ P2022 إن نقص عمود واحد.
    // v56: الشفاء الذاتي الثلاثة بالتوازي مع مهلة مشتركة — تعليق الشفاء لا يمنع الدخول
    // (الأعمدة الحرجة موجودة غالباً، والشفاء يُعاد في الطلب التالي تلقائياً)
    try {
      await withTimeout(
        Promise.all([
          ensurePurchasesSupport(),
          ensureVisitorAccount(),
          ensureHRSupport(),
          ensureMediaSupport(),
        ]),
        3000,
        'SELF_HEAL'
      )
    } catch (healErr) {
      console.error('Login self-heal timeout/error (continuing with login):', healErr)
    }

    // v56: التحقق من بيانات الدخول بمهلة 4.5 ثانية — bcrypt + جلب المستخدم
    var user: Awaited<ReturnType<typeof verifyCredentials>>
    try {
      user = await withTimeout(verifyCredentials(emailStr, password), 4500, 'VERIFY')
    } catch (verifyErr) {
      console.error('Login verify failed:', verifyErr)
      return NextResponse.json(
        {
          error: 'database_error',
          message: isTimeoutErr(verifyErr)
            ? 'التحقق من بيانات الدخول تجاوز المهلة — قاعدة البيانات بطيئة أو متوقفة. حاول مجدداً أو افحص لوحة Supabase.'
            : 'حدث خطأ أثناء التحقق من بيانات الدخول. يرجى المحاولة مرة أخرى.',
        },
        { status: 503 }
      )
    }
    if (!user) {
      return NextResponse.json(
        { error: 'invalidCredentials', message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' },
        { status: 401 }
      )
    }

    // v56: إنشاء الجلسة بمهلة — فشل JWT_SECRET يعطي رسالة صريحة بدل انهيار عام
    var token: string
    try {
      token = await withTimeout(createSession(user), 2000, 'JWT')
    } catch (jwtErr) {
      console.error('createSession failed during login:', jwtErr)
      return NextResponse.json(
        {
          error: 'internal_error',
          message: 'تعذر إنشاء الجلسة (JWT). راجع متغير البيئة JWT_SECRET في إعدادات Netlify (لا بد أن يكون 32 حرفاً على الأقل).',
        },
        { status: 500 }
      )
    }

    // v56: تحديث طابع آخر دخول دون انتظار — لا يحبس الاستجابة إن كانت قاعدة
    // البيانات بطيئة (غير حرج — مجرد طابع updatedAt)
    db.user
      .update({ where: { id: user.id }, data: { updatedAt: new Date() } })
      .catch(function () {})

    // C-6 FIX: Do NOT return token in body — it's in httpOnly cookie only
    var response = NextResponse.json({ user })
    response.cookies.set(SESSION_COOKIE, token, getCookieOptions())

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مرة أخرى.' },
      { status: 500 }
    )
  }
}
