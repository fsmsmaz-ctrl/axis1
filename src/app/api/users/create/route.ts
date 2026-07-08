import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

const ADMIN_EMAIL = 'admin@axis.om'

const ROLE_LABELS: Record<string, { ar: string; en: string }> = {
  top_management: { ar: 'الإدارة العليا', en: 'Top Management' },
  project_manager: { ar: 'مدير المشروع', en: 'Project Manager' },
  site_engineer: { ar: 'مهندس الموقع', en: 'Site Engineer' },
  hse_officer: { ar: 'مسؤول السلامة', en: 'HSE Officer' },
  foreman: { ar: 'المشرف', en: 'Foreman' },
  accountant: { ar: 'المحاسب', en: 'Accountant' },
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req)
    if (!authUser || authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
    }

    const users = await db.user.findMany({
      where: { active: true },
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
      orderBy: { createdAt: 'desc' },
    })

    const usersWithLabels = users.map(u => ({
      ...u,
      roleLabel: ROLE_LABELS[u.role] || { ar: u.role, en: u.role },
    }))

    const total = await db.user.count()
    const remainingSlots = Math.max(0, 50 - total)

    return NextResponse.json({ users: usersWithLabels, remainingSlots })
  } catch (error) {
    console.error('List users error:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
