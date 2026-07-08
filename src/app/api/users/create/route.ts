import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

const ADMIN_EMAIL = 'admin@axis.om'
const VALID_ROLES = ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'foreman', 'accountant']
const ALL_PERMISSIONS = [
  'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'performance',
  'rpt_daily_site', 'rpt_production', 'rpt_safety', 'rpt_attendance',
  'rpt_revenue', 'rpt_costs', 'rpt_profit', 'rpt_equipment',
  'rpt_weekly', 'rpt_monthly', 'rpt_handover',
]

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req)
    if (!authUser || authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const { name, nameEn, email, phone, role, password, permissions } = body

    if (!name?.trim() || !email?.trim() || !password?.trim() || !role) {
      return NextResponse.json({ error: 'Name, email, password and role are required' }, { status: 400 })
    }

    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (existing) {
      return NextResponse.json({ error: 'Email already exists', message: 'البريد الإلكتروني مستخدم بالفعل' }, { status: 409 })
    }

    // Check max users
    const userCount = await db.user.count()
    if (userCount >= 50) {
      return NextResponse.json({ error: 'Max users reached', message: 'تم بلوغ الحد الأقصى للمستخدمين (50)' }, { status: 400 })
    }

    // Clean permissions
    const cleanPerms: Record<string, boolean> = {}
    if (permissions) {
      for (const key of ALL_PERMISSIONS) {
        if (typeof permissions[key] === 'boolean') {
          cleanPerms[key] = permissions[key]
        }
      }
    }

    const passwordHash = await bcrypt.hash(password.trim(), 12)

    const user = await db.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password: passwordHash,
        name: name.trim(),
        nameEn: nameEn?.trim() || null,
        phone: phone?.trim() || null,
        role,
        language: 'ar',
        active: true,
        permissions: Object.keys(cleanPerms).length > 0 ? cleanPerms : undefined,
      },
      select: {
        id: true,
        email: true,
        name: true,
        nameEn: true,
        role: true,
        phone: true,
        permissions: true,
        active: true,
        createdAt: true,
      },
    })

    const total = await db.user.count()
    const remainingSlots = Math.max(0, 50 - total)

    return NextResponse.json({ user, remainingSlots, message: 'User created successfully' })
  } catch (error) {
    console.error('Register user error:', error)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}
