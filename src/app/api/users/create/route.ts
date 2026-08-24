import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

var ADMIN_EMAIL = 'admin@axis.om'
var VALID_ROLES = ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'foreman', 'accountant']

var ALL_PERMISSIONS = [
  'projects', 'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'performance', 'notifications',
  'rpt_daily_site', 'rpt_production', 'rpt_safety', 'rpt_attendance',
  'rpt_revenue', 'rpt_costs', 'rpt_profit', 'rpt_equipment',
  'rpt_weekly', 'rpt_monthly', 'rpt_handover',
]

export async function POST(req: NextRequest) {
  var rl = checkRateLimit(req, RateLimitPresets.auth)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  try {
    var authUser = await getAuthUser(req)
    if (!authUser || authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'forbidden', message: 'هذه العملية متاحة فقط لمدير النظام' }, { status: 403 })
    }

    var body = await req.json()
    var name = body.name
    var nameEn = body.nameEn
    var email = body.email
    var phone = body.phone
    var role = body.role
    var password = body.password
    var permissions = body.permissions

    if (!name?.trim() || !email?.trim() || !password?.trim() || !role) {
      return NextResponse.json({ error: 'missing_fields', message: 'الاسم والبريد الإلكتروني وكلمة المرور والدور مطلوبون' }, { status: 400 })
    }

    // H-5 FIX: Validate role
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'invalid_value', message: 'دور غير صالح' }, { status: 400 })
    }

    // M-6 FIX: Password minimum length
    if (password.trim().length < 6) {
      return NextResponse.json({ error: 'invalid_value', message: 'كلمة المرور قصيرة جداً (6 أحرف على الأقل)' }, { status: 400 })
    }

    var normalizedEmail = email.toLowerCase().trim()
    var existing = await db.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
      return NextResponse.json({ error: 'duplicate_entry', message: 'البريد الإلكتروني مستخدم بالفعل' }, { status: 409 })
    }

    var userCount = await db.user.count()
    if (userCount >= 50) {
      return NextResponse.json({ error: 'max_users', message: 'تم بلوغ الحد الأقصى للمستخدمين (50)' }, { status: 400 })
    }

    var cleanPerms: Record<string, boolean> = {}
    if (permissions && typeof permissions === 'object') {
      for (var i = 0; i < ALL_PERMISSIONS.length; i++) {
        var key = ALL_PERMISSIONS[i]
        if (typeof permissions[key] === 'boolean') {
          cleanPerms[key] = permissions[key]
        }
      }
    }

    var passwordHash = await bcrypt.hash(password.trim(), 12)

    var user = await db.user.create({
      data: {
        email: normalizedEmail, password: passwordHash, name: name.trim(),
        nameEn: nameEn?.trim() || null, phone: phone?.trim() || null,
        role, language: 'ar', active: true,
        permissions: Object.keys(cleanPerms).length > 0 ? cleanPerms : undefined,
      },
      select: { id: true, email: true, name: true, nameEn: true, role: true, phone: true, permissions: true, active: true, createdAt: true },
    })

    var total = await db.user.count()
    var remainingSlots = Math.max(0, 50 - total)

    return NextResponse.json({ user, remainingSlots, message: 'تم إنشاء المستخدم بنجاح' })
  } catch (error) {
    console.error('Create user error:', error)
    return handleDbError(error, 'إنشاء المستخدم')
  }
}
