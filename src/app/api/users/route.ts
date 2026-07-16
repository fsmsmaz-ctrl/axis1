import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { handleDbError } from '@/lib/api-helpers'

const ADMIN_EMAIL = 'admin@axis.om'

export async function GET(req: NextRequest) {
  const me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const users = await db.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        nameEn: true,
        phone: true,
        role: true,
        active: true,
        language: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const usersWithPerms = users.map(u => ({
      ...u,
      permissions: u.permissions ?? {},
    }))

    return NextResponse.json({ users: usersWithPerms })
  } catch (error) {
    return handleDbError(error, 'جلب المستخدمين')
  }
}

export async function POST(req: NextRequest) {
  const me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const body = await req.json()
    const { email, password, name, nameEn, phone, role, active, language, permissions } = body

    if (!email || !password || !name || !role) {
      return NextResponse.json({ error: 'missing_fields', message: 'البريد الإلكتروني والاسم وكلمة المرور والدور مطلوبون' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()

    const existing = await db.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
      return NextResponse.json({ error: 'duplicate_entry', message: 'البريد الإلكتروني مستخدم بالفعل' }, { status: 400 })
    }

    const hashed = await bcrypt.hash(password, 12)

    // Clean permissions — only keep known boolean keys
    const VALID_PERMS = [
      'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'performance',
      'rpt_daily_site', 'rpt_production', 'rpt_safety', 'rpt_attendance',
      'rpt_revenue', 'rpt_costs', 'rpt_profit', 'rpt_equipment',
      'rpt_weekly', 'rpt_monthly', 'rpt_handover',
    ]
    const cleanPerms: Record<string, boolean> = {}
    if (permissions && typeof permissions === 'object') {
      for (const key of VALID_PERMS) {
        if (typeof permissions[key] === 'boolean') {
          cleanPerms[key] = permissions[key]
        }
      }
    }

    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        password: hashed,
        name: name.trim(),
        nameEn: nameEn?.trim() || null,
        phone: phone?.trim() || null,
        role,
        active: active !== false,
        language: language || 'ar',
        permissions: Object.keys(cleanPerms).length > 0 ? cleanPerms : null,
      },
      select: { id: true, email: true, name: true },
    })

    return NextResponse.json({ success: true, userId: user.id })
  } catch (error) {
    return handleDbError(error, 'إنشاء المستخدم')
  }
}
