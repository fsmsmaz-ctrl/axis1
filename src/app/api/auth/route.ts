// ====================================================
// THIS FILE BELONGS TO: src/app/api/auth/route.ts
// Purpose: LOGIN endpoint (POST /api/auth)
// DO NOT swap with init/route.ts!
// ====================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials, createSession, getSessionMaxAge, getCookieOptions, SESSION_COOKIE } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // Rate limit: max 5 login attempts per minute per IP
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
        { error: 'missing_fields', message: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Validate email format
    var emailStr = String(email).toLowerCase().trim()
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailStr)) {
      return NextResponse.json(
        { error: 'invalid_input', message: 'صيغة البريد الإلكتروني غير صحيحة' },
        { status: 400 }
      )
    }

    // Validate password length
    if (String(password).length < 1) {
      return NextResponse.json(
        { error: 'missing_fields', message: 'كلمة المرور مطلوبة' },
        { status: 400 }
      )
    }

    // Quick database connectivity check before verifying credentials
    try {
      await db.$queryRaw`SELECT 1`
    } catch (dbErr) {
      console.error('Database connection failed during login:', dbErr)
      return NextResponse.json(
        { error: 'database_error', message: 'Database connection failed. Check DATABASE_URL and DIRECT_URL environment variables on Netlify.' },
        { status: 500 }
      )
    }

    var user = await verifyCredentials(emailStr, password)
    if (!user) {
      return NextResponse.json(
        { error: 'invalidCredentials', message: 'Invalid email or password' },
        { status: 401 }
      )
    }

    var token = await createSession(user)

    try {
      await db.user.update({
        where: { id: user.id },
        data: { updatedAt: new Date() },
      })
    } catch {}

    var response = NextResponse.json({ user, token })
    response.cookies.set(SESSION_COOKIE, token, getCookieOptions())

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'An error occurred during login. Please try again.' },
      { status: 500 }
    )
  }
}
