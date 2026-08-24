// Login endpoint (POST /api/auth)
// C-6 FIX: No token in response body — relies on httpOnly cookie only
// M-6 FIX: Minimum password length 4
// C-3 FIX: No default passwords

import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials, createSession, getSessionMaxAge, getCookieOptions, SESSION_COOKIE } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

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

    // M-6 FIX: Minimum 4 characters
    if (String(password).length < 4) {
      return NextResponse.json(
        { error: 'missing_fields', message: 'كلمة المرور قصيرة جداً (4 أحرف على الأقل)' },
        { status: 400 }
      )
    }

    try {
      await db.$queryRaw\`SELECT 1\`
    } catch (dbErr) {
      console.error('Database connection failed during login:', dbErr)
      return NextResponse.json(
        { error: 'database_error', message: 'فشل الاتصال بقاعدة البيانات. يرجى المحاولة لاحقاً.' },
        { status: 500 }
      )
    }

    var user = await verifyCredentials(emailStr, password)
    if (!user) {
      return NextResponse.json(
        { error: 'invalidCredentials', message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' },
        { status: 401 }
      )
    }

    var token = await createSession(user)

    try {
      await db.user.update({ where: { id: user.id }, data: { updatedAt: new Date() } })
    } catch {}

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
