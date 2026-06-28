import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

const ADMIN_EMAIL = 'admin@axis.om'

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

    return NextResponse.json({ users })
  } catch (error) {
    console.error('List users error:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
