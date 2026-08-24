import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { VALID_ROLES } from '@/lib/auth'

var VALID_PERMS = [
  'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'performance',
  'rpt_daily_site', 'rpt_production', 'rpt_safety', 'rpt_attendance',
  'rpt_revenue', 'rpt_costs', 'rpt_profit', 'rpt_equipment',
  'rpt_weekly', 'rpt_monthly', 'rpt_handover',
]

export async function GET(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    var users = await db.user.findMany({
      select: { id: true, email: true, name: true, nameEn: true, phone: true, role: true, active: true, language: true, permissions: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ users: users.map(function(u) { return { ...u, permissions: u.permissions ?? {} } }) })
  } catch (error) {
    return handleDbError(error, 'جلب المستخدمين')
  }
}

export async function POST(req: NextRequest) {
  var rl = checkRateLimit(req, RateLimitPresets.auth)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  var me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    var body = await req.json()
    var email = body.email
    var password = body.password
    var name = body.name
    var role = body.role

    if (!email || !password || !name || !role) {
      return NextResponse.json({ error: 'missing_fields', message: 'البريد الإلكتروني والاسم وكلمة المرور والدور مطلوبون' }, { status: 400 })
    }

    // H-5 FIX: Validate role against whitelist
    if (!(VALID_ROLES as readonly string[]).includes(role)) {
      return NextResponse.json({ error: 'invalid_value', message: 'دور غير صالح. الأدوار المسموحة: ' + VALID_ROLES.join(', ') }, { status: 400 })
    }

    // M-6 FIX: Password minimum length
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'invalid_value', message: 'كلمة المرور قصيرة جداً (6 أحرف على الأقل)' }, { status: 400 })
    }

    var normalizedEmail = email.trim().toLowerCase()
    var existing = await db.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
      return NextResponse.json({ error: 'duplicate_entry', message: 'البريد الإلكتروني مستخدم بالفعل' }, { status: 400 })
    }

    var hashed = await bcrypt.hash(password, 12)
    var cleanPerms: Record<string, boolean> = {}
    if (body.permissions && typeof body.permissions === 'object') {
      for (var i = 0; i < VALID_PERMS.length; i++) {
        var key = VALID_PERMS[i]
        if (typeof body.permissions[key] === 'boolean') cleanPerms[key] = body.permissions[key]
      }
    }

    var user = await db.user.create({
      data: {
        email: normalizedEmail, password: hashed, name: name.trim(),
        nameEn: body.nameEn?.trim() || null, phone: body.phone?.trim() || null,
        role, active: body.active !== false, language: body.language || 'ar',
        permissions: Object.keys(cleanPerms).length > 0 ? cleanPerms : null,
      },
      select: { id: true, email: true, name: true },
    })
    return NextResponse.json({ success: true, userId: user.id })
  } catch (error) {
    return handleDbError(error, 'إنشاء المستخدم')
  }
}
