import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

const ADMIN_EMAIL = 'admin@axis.om'

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json(
        { error: 'Access denied.' },
        { status: 403 }
      )
    }

    const users = await db.user.findMany({
      where: { email: { not: ADMIN_EMAIL } },
      select: {
        id: true,
        email: true,
        name: true,
        nameEn: true,
        role: true,
        phone: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    const roleLabels: Record<string, { ar: string; en: string }> = {
      top_management: { ar: 'الإدارة العليا', en: 'Top Management' },
      project_manager: { ar: 'مدير المشروع', en: 'Project Manager' },
      site_engineer: { ar: 'مهندس الموقع', en: 'Site Engineer' },
      hse_officer: { ar: 'مسؤول السلامة', en: 'HSE Officer' },
      foreman: { ar: 'المشرف', en: 'Foreman' },
      accountant: { ar: 'المحاسب', en: 'Accountant' },
    }

    const usersWithLabels = users.map(u => ({
      ...u,
      roleLabel: roleLabels[u.role] || { ar: u.role, en: u.role },
    }))

    return NextResponse.json({
      users: usersWithLabels,
      total: users.length,
      maxUsers: 50,
      remainingSlots: 50 - users.length,
    })
  } catch (error) {
    console.error('List users error:', error)
    return NextResponse.json({ error: 'Failed to list users.' }, { status: 500 })
  }
}
