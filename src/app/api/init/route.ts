// Database init endpoint (POST /api/init)
// C-3 FIX: No default password — requires INIT_ADMIN_PASSWORD env var
// M-7 FIX: GET returns only needsInit boolean

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

var ADMIN_EMAIL = 'admin@axis.om'

export async function POST(req: NextRequest) {
  var rl = checkRateLimit(req, RateLimitPresets.auth)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var authHeader = req.headers.get('authorization')
    var body = await req.json().catch(function() { return {} })
    var initKey = body.initKey || (authHeader ? authHeader.replace('Bearer ', '') : '')

    var expectedKey = process.env.INIT_SECRET_KEY
    if (!expectedKey) {
      return NextResponse.json({ error: 'INIT_SECRET_KEY not configured' }, { status: 500 })
    }
    if (initKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // C-3 FIX: No default password — must be provided via env var
    var adminPassword = process.env.INIT_ADMIN_PASSWORD
    if (!adminPassword || adminPassword.length < 8) {
      return NextResponse.json(
        { error: 'INIT_ADMIN_PASSWORD not configured or too short (min 8 chars)' },
        { status: 500 }
      )
    }

    var userCount = 0
    try {
      userCount = await db.user.count()
    } catch {
      return NextResponse.json({
        error: 'Database tables not accessible',
        hint: 'Run npx prisma migrate deploy to apply migrations',
      }, { status: 500 })
    }

    var passwordHash = await bcrypt.hash(adminPassword, 12)
    var createdUsers: string[] = []

    try {
      await db.user.upsert({
        where: { email: ADMIN_EMAIL },
        update: {},
        create: {
          email: ADMIN_EMAIL, password: passwordHash,
          name: 'مدير النظام',
          nameEn: 'System Admin', phone: '+96891234567',
          role: 'top_management', language: 'ar', active: true,
        },
      })
      createdUsers.push(ADMIN_EMAIL)
    } catch (e) {
      console.error('Failed to upsert admin:', e)
    }

    if (userCount === 0) {
      var defaultUsers = [
        { email: 'ceo@axis.om', name: 'أحمد البلوشي', nameEn: 'Ahmed Al-Balushi', phone: '+96891234567', role: 'top_management' },
        { email: 'pm@axis.om', name: 'خالد الحبسي', nameEn: 'Khalid Al-Habsi', phone: '+96892345678', role: 'project_manager' },
        { email: 'engineer@axis.om', name: 'سالم الكندي', nameEn: 'Salem Al-Kindi', phone: '+96893456789', role: 'site_engineer' },
        { email: 'hse@axis.om', name: 'محمد العبري', nameEn: 'Mohammed Al-Abri', phone: '+96894567890', role: 'hse_officer' },
        { email: 'foreman@axis.om', name: 'ناصر الشحي', nameEn: 'Nasser Al-Shehhi', phone: '+96895678901', role: 'foreman' },
        { email: 'finance@axis.om', name: 'عائشة الرواحية', nameEn: 'Aisha Al-Rawahi', phone: '+96896789012', role: 'accountant' },
      ]

      for (var i = 0; i < defaultUsers.length; i++) {
        var u = defaultUsers[i]
        try {
          await db.user.create({
            data: {
              email: u.email, password: passwordHash, name: u.name, nameEn: u.nameEn,
              phone: u.phone, role: u.role, language: 'ar', active: true,
            },
          })
          createdUsers.push(u.email)
        } catch (e) {
          console.error('Failed to create user ' + u.email + ':', e)
        }
      }
    }

    if (createdUsers.length === 0) {
      return NextResponse.json({ error: 'Failed to create any users' }, { status: 500 })
    }

    return NextResponse.json({ initialized: true, message: 'Database initialized successfully' })
  } catch (error) {
    console.error('Init error:', error)
    return NextResponse.json({ error: 'Failed to initialize database' }, { status: 500 })
  }
}

// M-7 FIX: Only return needsInit — no userCount or dbAccessible
export async function GET() {
  try {
    var userCount = await db.user.count()
    return NextResponse.json({ needsInit: userCount === 0 })
  } catch {
    return NextResponse.json({ needsInit: true })
  }
}
