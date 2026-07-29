// ====================================================
// THIS FILE BELONGS TO: src/app/api/init/route.ts
// Purpose: Database init endpoint (POST /api/init)
// Creates admin@axis.om and default users
// DO NOT swap with auth/route.ts!
// ====================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

var ADMIN_EMAIL = 'admin@axis.om'

export async function POST(req: NextRequest) {
  // Rate limit init endpoint strictly
  var rl = checkRateLimit(req, RateLimitPresets.auth)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    // Protect init endpoint with a secret key
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

    // Step 1: Check database accessibility
    var userCount = 0
    try {
      userCount = await db.user.count()
    } catch (countError) {
      return NextResponse.json({
        error: 'Database tables not accessible',
        hint: 'Run `npx prisma migrate deploy` to apply migrations to Supabase',
      }, { status: 500 })
    }

    var adminPassword = process.env.INIT_ADMIN_PASSWORD || 'Axis@2025!Secure'
    var passwordHash = await bcrypt.hash(adminPassword, 10)
    var createdUsers: string[] = []

    // Step 2: ALWAYS ensure admin@axis.om exists (upsert)
    try {
      await db.user.upsert({
        where: { email: ADMIN_EMAIL },
        update: {},
        create: {
          email: ADMIN_EMAIL,
          password: passwordHash,
          name: '\u0645\u062f\u064a\u0631 \u0627\u0644\u0646\u0638\u0627\u0645',
          nameEn: 'System Admin',
          phone: '+96891234567',
          role: 'top_management',
          language: 'ar',
          active: true,
        },
      })
      createdUsers.push(ADMIN_EMAIL)
    } catch (e) {
      console.error('Failed to upsert admin:', e)
    }

    // Step 3: Create other default users ONLY on first init (empty database)
    if (userCount === 0) {
      var defaultUsers = [
        { email: 'ceo@axis.om', name: '\u0623\u062d\u0645\u062f \u0627\u0644\u0628\u0644\u0648\u0634\u064a', nameEn: 'Ahmed Al-Balushi', phone: '+96891234567', role: 'top_management' },
        { email: 'pm@axis.om', name: '\u062e\u0627\u0644\u062f \u0627\u0644\u062d\u0628\u0633\u064a', nameEn: 'Khalid Al-Habsi', phone: '+96892345678', role: 'project_manager' },
        { email: 'engineer@axis.om', name: '\u0633\u0627\u0644\u0645 \u0627\u0644\u0643\u0646\u062f\u064a', nameEn: 'Salem Al-Kindi', phone: '+96893456789', role: 'site_engineer' },
        { email: 'hse@axis.om', name: '\u0645\u062d\u0645\u062f \u0627\u0644\u0639\u0628\u0631\u064a', nameEn: 'Mohammed Al-Abri', phone: '+96894567890', role: 'hse_officer' },
        { email: 'foreman@axis.om', name: '\u0646\u0627\u0635\u0631 \u0627\u0644\u0634\u062d\u064a', nameEn: 'Nasser Al-Shehhi', phone: '+96895678901', role: 'foreman' },
        { email: 'finance@axis.om', name: '\u0639\u0627\u0626\u0634\u0629 \u0627\u0644\u0631\u0648\u0627\u062d\u064a\u0629', nameEn: 'Aisha Al-Rawahi', phone: '+96896789012', role: 'accountant' },
      ]

      for (var i = 0; i < defaultUsers.length; i++) {
        var u = defaultUsers[i]
        try {
          await db.user.create({
            data: {
              email: u.email,
              password: passwordHash,
              name: u.name,
              nameEn: u.nameEn,
              phone: u.phone,
              role: u.role,
              language: 'ar',
              active: true,
            },
          })
          createdUsers.push(u.email)
        } catch (e) {
          console.error('Failed to create user ' + u.email + ':', e)
        }
      }
    }

    if (createdUsers.length === 0) {
      return NextResponse.json({
        error: 'Failed to create any users',
      }, { status: 500 })
    }

    return NextResponse.json({
      initialized: true,
      message: 'Database initialized successfully',
      userCount: createdUsers.length,
      adminEmail: ADMIN_EMAIL,
      users: createdUsers,
    })
  } catch (error) {
    console.error('Init error:', error)
    return NextResponse.json(
      { error: 'Failed to initialize database' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    var userCount = 0
    var dbAccessible = true

    try {
      userCount = await db.user.count()
    } catch (e) {
      dbAccessible = false
    }

    return NextResponse.json({
      needsInit: !dbAccessible || userCount === 0,
      userCount,
      dbAccessible,
    })
  } catch (e) {
    return NextResponse.json(
      { needsInit: true, dbAccessible: false },
      { status: 200 }
    )
  }
}
